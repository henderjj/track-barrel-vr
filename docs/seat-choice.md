# Seat choice and calibration (F1.2)

Picking a seat before the game starts, swapping seats only when both players want to, and a short calibration that puts every player's eyes on their seat's eye point, seated or standing. It builds on the cabin and seats ([cabin.md](cabin.md)) and the template's body height (`src/sim/body-height.ts`). The logic is engine-free in [`src/sim/calibration.ts`](../src/sim/calibration.ts), [`src/sim/body-height.ts`](../src/sim/body-height.ts) and [`src/sim/cabin.ts`](../src/sim/cabin.ts); the systems are `CalibrationSystem`, `SeatSystem` and the start screen and game menu.

## What players experience

- **The start screen picks the seat.** The home page has a **Your seat: Driver | Gunner** row under the ways to play, and the crew page has the same row with a line saying where both players sit. The seat in effect is lit. The choice is kept in the browser for next time (`seat`).
- **In a crew the host keeps their seat.** If both pick the same seat before meeting, whoever started the crew keeps it and the other player gets the other seat; the crew page says so.
- **Swapping needs both players.** Once the crewmate is aboard, asking for their seat (Practice → Sit in, You → Seat → Swap seats, or the crew page) asks them. A sign in front of the crewmate says "Your crewmate asks to swap seats. To agree: game menu (Y), Swap seats", and their Swap seats button reads **Agree to swap**. When they press it (or ask for the other seat themselves) both players move at once. An ask nobody answers lapses after 30 s. The practice crewmate always agrees, so Practice → Sit in still works at once when testing alone with it. Alone, a seat is taken at once.
- **Calibration as VR starts.** Once the start screen is out of the way, a sign asks the player to "Sit back as you will play, look straight ahead and hold still" (or "Stand…" when playing standing), with a bar filling as they hold still. After 1.5 s still, their eye height is taken and they are moved so their eyes are on the seat's eye point. The sign then asks them to "Hold both hands out in front as far as is comfortable, and squeeze both grips", which records their reach. It says "Calibrated" for a moment and goes. **A** on the right controller skips a step. It waits while the game menu or the start screen is open, or while a spike seats the player elsewhere.
- **Seated or standing, the same view.** You → Playing → Seated (the default) or Standing changes what calibration asks and calibrates again; either way the eyes land on the seat's eye point, so the vision slit, the sight and every control are where the cabin was built for. A standing player is lowered, a seated one raised.
- **Eye height.** You → Eye height raises or drops the eyes from the seat's eye point in 5 cm steps, up to 15 cm either way, for a player who wants to sit taller or lower; **Eye point** goes back. It replaces the template's character height, which put a seated player's eyes at standing height and, at 2 m, through the driver's roof.
- **The roof fades the view.** Standing up out of the chair, or rising more than the seat allows, fades the view to black over 8 cm under the roof, the same way leaning past the head box does at the walls ([cabin.md](cabin.md)); it used to lower the play space. A step across the room still puts the player back in the seat.
- **Calibrate again** is in the game menu (You → Calibration), with a line saying the eye height and reach it took.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Hold still for | 1.5 s, within 3 cm up and down | Long enough to settle into the chair, short enough not to nag |
| Eye heights taken | 0.7 to 2.3 m above the real floor | Outside is a headset off, on the floor, or a bad floor |
| Reach taken | 30 to 95 cm, level from the eyes to each hand, averaged, both grips squeezed | Below is a hand at rest; the concept puts controls 30 to 60 cm from the shoulders |
| Seat's eye point | 1.45 m above the seat's floor (`SEATED_EYE`) | The cabin is built round it ([cabin.md](cabin.md#numbers)) |
| Eye height steps | 5 cm, up to ±15 cm | Still leaves room to sit up 5 cm before the roof fades the view |
| Highest eyes, driver | 20 cm above the eye point | The hull roof (1.8 m) less the 13 cm from eyes to the top of the head and 2 cm clearance |
| Highest eyes, gunner | 35 cm above the eye point | The turret roof (2.75 m), the same way |
| Swap ask lapses after | 30 s | Long enough to finish a manoeuvre and open the menu |
| Swap sign | 8 s | Long enough to read twice; the menu button keeps saying it after |

Reach is recorded, not yet used: plan 4.1 scales the controls by it only if the play tests show short or long arms struggling. F1.3–F1.5 can read it as `body.reach` (NaN if skipped). F2.1's hatch reads the calibrated eye height (`body.calibratedEye`): rising 25 cm above it opens the hatch, which for a standing player will need another way (a button), since they can't rise that far.

## Sharing

The host still decides who sits where and sends `seats` `{ host, guest }` ([cabin.md](cabin.md#sharing)). What changes is when a swap happens:

- A guest asking for the host's seat sends `seat-ask` `{ seat }`. Asking for their own seat changes nothing.
- A host asking for the guest's seat sends `seat-offer` `{}`.
- The host keeps the time each player last asked. When both asks are within 30 s of each other (`swapAgreed` in `src/sim/cabin.ts`) it swaps both and sends `seats`. Each page shows its own state: `asked` (waiting for the crewmate) or `offered` (the crewmate is waiting), cleared by `seats`, by a disconnect or after 30 s.
- The practice crewmate's page answers a `seat-offer` with a `seat-ask` at once, and as a host agrees to any `seat-ask` at once.
- Before the crewmate is aboard there is no one to ask: the seat is taken at once, and on connecting the host keeps theirs as before.
- On connecting the guest also sends `seats-please` `{}` and the host answers with `seats`. The host's first `seats` can arrive before the guest's page has seen its own connection, while it still counts itself a host and drops it; without the ask both players were left in the driver's seat.

Calibration and eye height are each player's own; nothing about them goes over the network. The crewmate sees the result, since poses are sent in hull space with the offset included.

## The practice crewmate

It agrees to every swap (above). It doesn't calibrate: its page has no headset, and its head sits at the eye point already.

## Tests

- `test/calibration.test.ts`: the eye height taken after holding still, a settle and a sway, a headset on the floor ignored, a standing head; the reach taken only with both grips and both hands out; skipping.
- `test/body-height.test.ts`: seated or standing, any eye height lands on either seat's eye point; the eye-height steps; the URL settings (seated by default).
- `test/cabin.test.ts`: the highest eyes keep the head just under each roof, with room for the menu's raise; the roof stop; a swap only when both asked within the wait.
- `test/game-flow.test.ts`: the eye-height steps and words, the calibration line, the crew page's seats line.
- `npm run test:xr`: the start screen's seat buttons pick, light and keep the seat; calibration seated (eyes on the driver's eye point, reach from both hands held out and both grips, the sign gone), then standing (the same eye point); the menu's standing and seated play and eye-height steps; the eyes 5 cm up from the menu; standing up out of the seat fading the view under the roof. Screenshot: `artifacts/xr-calibration.png`.
- `npm run test:net` (`ONLY_SEATS=1`, or `=lag`): the guest's ask reaching the host with nobody moving, the host agreeing and both swapping, then the host asking and the guest agreeing, on a clean link, after a rejoin and at 150 ms RTT; the practice crewmate agreeing when the player changes seats (`ONLY_BOT=1`); the menu's eye height saved.

`window.__calibration` gives `step`, `eye`, `reach`, `progress`, `sign`, `start()` and `skip()`; `window.__seats` adds `swap`, `swapSign` and `fixes.roof`; `window.__body.state` has `calibratedEye` and `reach`; `window.__startScreen.selected(id)` says which seat button is lit.

## Headset check

On a Quest 3, sitting on a chair, with a second headset or the practice crewmate for steps 7 and 8:

1. Open the game and enter VR. On the start screen, press **Your seat: Gunner**, then **Driver**: the one you pressed lights. Press **Play solo**.
2. The calibration sign asks you to sit back and look ahead. Sit as you will play and hold still: the bar fills, and you should end up with your eyes at the vision slit's height, the slit straight ahead. Say whether the view felt like it jumped.
3. Hold both hands out in front and squeeze both grips. The sign says "Calibrated" and goes. Open the game menu (Y): the Calibration line shows your eye height and reach. Report both numbers.
4. Stand up from the chair. The view fades to black under the hull roof rather than going through it. Sit down again: it clears.
5. Game menu → You → Eye height **+** twice: your eyes go up 10 cm. **Eye point** brings them back. Say whether you would rather sit higher or lower than the eye point.
6. Game menu → You → Playing → **Standing**, then stand up: calibration asks you to stand as you will play. Once taken, you see the same view as seated. Switch back to **Seated** and sit down.
7. With the practice crewmate (`?bot=1` on a PC page): Practice → Sit in Gunner. You both swap at once, as the crewmate always agrees.
8. With a second headset: one player presses You → Seat → Swap seats. The other sees a sign asking them to agree, and their menu says **Agree to swap**; pressing it swaps both of you. Ask again and don't answer: after 30 s the ask lapses.
9. Close the game and open it again: the start screen remembers the seat you picked last.
