# Start screen and game menu

How players get into a game and change settings without leaving VR. The rules here came from headset playtests of the game this template was built from: choosing how to play happens in VR, nothing stands in front of the player once a game has started, and settings live in a menu on a button press.

## Getting into a game

The browser page keeps only what has to happen in the browser: **Enter VR** with a line under it saying how a start is going (the PC VR hints from [spikes/s8-pcvr.md](spikes/s8-pcvr.md)), **Allow microphone** (a permission prompt inside VR is easy to miss), a line saying how the crew is doing, a **Game menu** button and the **Start-up settings** that reload the page. Keep the page's own Enter VR button: Quest Browser's own offer goes away once a crew connects.

When VR starts, the start screen (`public/ui/start.uikitml`, `src/systems/start-screen-system.ts`) stands a metre in front of the player, a little below eye level, and is picked with either controller's ray and trigger. It is drawn over the world, so nothing in the scene cuts through it, and if the player turns well away from it, it moves back in front of them. On a browser without a headset it shows on the page and takes the mouse, so a desktop crewmate or the practice crewmate's PC page uses the same screen.

- **Play solo** closes it and the game is on.
- **Solo with the practice crewmate** starts a crew and shows its code with a link (`?room=CODE&bot=1`) to open on a PC, which then plays the second player.
- **Start a crew** makes a four-letter code to give a friend.
- **Your seat: Driver, Gunner** (F1.2, [seat-choice.md](seat-choice.md)) picks the seat and keeps it for next time. The crew page has the same row and says where both of you sit.
- **Join a crew** shows a keypad of the 23 letters codes use; on a PC the keyboard types too. On a page without a headset, **Join as practice crewmate** reloads the page as the bot in that crew.

In a crew the crew page says what is happening (joining, waiting, connecting, full, or the lobby's error). Once the crewmate is aboard it says so for a moment and closes by itself; **Play while waiting** closes it without waiting, and **Leave crew** goes back. A page opened from a link with a crew code goes straight to the crew page, and the practice crewmate's page never shows the screen.

## The game menu

**Y** on the left controller opens and closes the game menu (`public/ui/menu.uikitml`, `src/systems/game-menu-system.ts`) in front of the player. The menu button (≡) does too where the browser passes it on, but SteamVR and others often keep that button, so Y is the one to rely on. **B** on the right controller also closes it. On a PC page, **M** or the **Game menu** button opens it and **Escape** closes it. Nothing pauses while it is open.

How it should look and work (each rule fixed something a headset playtest found hard):

- **See every choice, pick it in one press.** A controller ray is less precise than a mouse. Every setting with up to four choices shows them all as a row of buttons with the one in effect filled in. No drop-down lists: they need two accurate presses and open over the rows below.
- **Show things as what they are.** Coat colours are round swatches with a ring round the one you wear. No hover styles: under an XR ray a hover outline stays on everything the ray touched.
- **Numbers step.** Eye height is **−** and **+** in 5 cm steps, up to 15 cm either side of the seat's eye point, with an **Eye point** button.
- **Changes apply at once and are kept** in the browser. Settings that need a reload stay on the page's Start-up settings.
- **Far enough to take in at a glance:** 1.3 m in front, 0.2 m below eye level. One panel, no pages; past about a dozen rows, add tabs along the top.

| Group | Row | Choices |
| --- | --- | --- |
| Crew (only in a crew) | My microphone | On, Muted |
| Crew | Crewmate's voice | On, Muted (for you only) |
| You | Coat colour | Eight swatches |
| You | Playing | Standing, Seated (the default): either way your eyes land on the seat's eye point; changing it calibrates again |
| You | Eye height | − and + in 5 cm steps from the seat's eye point, Eye point |
| You | Seat | Back in my seat (eyes back at the seat's eye point, facing forward); Swap seats (in a crew it asks your crewmate, or agrees to their ask: [seat-choice.md](seat-choice.md)) |
| You | Calibration | Calibrate again; the line below says the eye height and reach it took |
| Sound and view | Tank sounds | On, Quiet, Off ([audio.md](audio.md)) |
| Sound and view | Perf HUD (X) | On, Off |
| Sound and view | Frame rate (Hz) | 72, 80, 90, 120 |
| Sound and view | Foveation | Off, Half, Full |
| Practice | Sit in | Driver, Gunner: in a crew the crewmate's seat asks them to swap, and both move once they agree ([seat-choice.md](seat-choice.md)) |
| Practice | Loading (S4): Sit at the breech | Your head over the loader's seat facing the gun, every shell in the rack, the breech open and the drill's stats cleared (yours only: the drill isn't shared) |

Below them, **Back to start screen** leaves any crew and shows the start screen, and **Exit VR** ends the session.

Add a Practice button for each feature that jumps straight to the situation its headset check needs. In a crew, a guest's Practice button asks the host, who sets it up for both.

In code, the crew, Playing and live-setting rows are `CHOICE_ROWS` in the menu system; the live settings come from `LIVE_ITEMS` in `src/live-settings.ts`, applied by the system that owns each from `onSettingChange`. A new live setting is one `LIVE_ITEMS` entry (up to four choices) plus a `row-<key>` row in the panel. Start-up settings are `MENU_ITEMS` in `src/settings-menu.ts`.

## Checks

Unit tests cover the words on the crew page and the menu, typing a code, the eye-height steps, and saving the settings. The emulated-headset test (`npm run test:xr`) checks the start screen stands in front of the player when VR starts, a ray click on **Play solo** closes it, Y opens the menu in front of the player, the ray turns the HUD off and on, picks standing and seated play, steps the eye height and picks a coat, and Y and B close it. The two-player test (`npm run test:net`) checks a crew link's start screen closes once the crewmate is aboard, joining a crew from the keypad, muting yourself and the crewmate, the coat colour reaching the crewmate, the HUD and eye-height settings saving at once, and the start-up settings keeping the menu's choices when they reload the page.

## Headset check

1. Open the game in Quest Browser and press **Enter VR** on the page. The start screen should stand in front of you.
2. Point at **Play solo** and pull the trigger: nothing should be left in front of you.
3. Press **Y**. Try a coat swatch (your cuffs change), **Seated** and **Standing**, **+** and **−** on the eye height, and the frame rate (the wrist HUD shows the new Hz). Say whether anything is hard to hit with the ray or hard to read. Press Y again to close it.
4. With a second player or the practice crewmate, try **My microphone: Muted** and **Crewmate's voice: Muted**.
