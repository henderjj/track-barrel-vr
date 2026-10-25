# The demo: blocks and a hoop

This is the template's example game and the model for a feature's design note: what the players experience, the numbers, how the two players share it, what the host decides, what goes over the network, how it is tested, and a numbered headset check at the end. Replace the game; keep the shape of this note for each feature you add.

## What the players do

Two players stand on a raised wooden deck, 3 m wide and 4 m long, with a rail 1 m high round it and grass 40 cm below. At the far end a waist-high table (80 cm) holds six coloured blocks, 10 cm cubes with a dark band so their spin reads in the air. Beyond the far rail, 60 cm out and 2 m up, a brass hoop with a 35 cm inner radius stands on a post. A block thrown through the hoop scores a point, shown on a scoreboard on the far rail, which flashes gold for each one. Players also throw blocks to each other and catch them.

Blocks that go over the rail land on the grass and come back to the table once they stop. The game menu's **Restart** puts the score back to nought and every block back on the table; **Practice → Back on the table** puts the blocks back without touching the score.

## Numbers

All sizes are in `src/sim/play-area.ts`, used by the model (`src/scene-assets/deck.scene-asset.ts`), the systems, the practice crewmate and the tests.

| Thing | Value |
| --- | --- |
| Deck | 3 m × 4 m, rail 1 m, ground 0.4 m below |
| Table | middle (0, −1.2), 1 m × 0.5 m, top 0.8 m |
| Hoop | middle (0, 2.0, −2.6), inner radius 0.35 m, facing along Z |
| Blocks | 6 (`?blocks=`), 10 cm, 500 kg/m³, laid in rows of four |
| Scoring | the block's centre crosses the hoop's plane going away from the players, at least half a block inside the ring |
| Invisible walls | 1.15 m tall at the deck edges, so a dropped block stays aboard |
| Start spots | host (0, 0.9), crewmate (0.6, −0.3) |

## Sharing it

- **Who decides:** the host (the player who started the crew, or the only player). It checks every block each frame with `throughHoop` (`src/sim/score.ts`), including ones the guest threw, which it draws from the guest's packets, and only counts blocks no one is holding.
- **What goes over the network:** blocks travel as `Object` packets (the holder or last thrower owns each block, `src/net/ownership.ts`). The score goes as a reliable `score` event with the new total and whether a point was just scored, so the guest's board flashes too. Restart is a `restart` event: a guest's press asks the host, which restarts and tells the guest. Back on the table is a `blocks` event, since each player puts back the blocks they own.
- **Alone:** everything works solo. The practice crewmate catches blocks thrown near its hands and throws them back.

## Tests

- `test/score.test.ts`: through the middle, through the edge, missing, going the wrong way.
- `test/z-fighting.test.ts`: the play area, every block and the crew avatars.
- `scripts/xr-smoke-test.mjs`: the blocks start on the table, grab and drop, a scripted throw through the hoop scores a point, Restart puts it back to nought.
- `scripts/net-test.mjs`: a block the guest throws scores once, on the host, and both boards show it; a block the host throws scores and the guest sees it; the guest's Restart restarts both; the practice crewmate catches and throws back.

The test hook is `window.__game` (`score`, `restart()`, `resetBlocks()`).

## Headset check

1. Open the game, choose **Play solo** and enter VR. You stand at the near end of the deck facing the table, the hoop beyond it and the scoreboard on the far rail reading 0.
2. Walk to the table (or use the left thumbstick) and pick up a block with the grip. Your glove closes on it.
3. Throw it through the hoop. The scoreboard flashes gold and reads 1.
4. Throw a block over the side rail. Once it stops on the grass, it comes back to the table.
5. Open the game menu (Y), press **Restart**. The score reads 0 and the blocks are back on the table.
6. With the practice crewmate on a PC (start screen → **Solo with the practice crewmate**), throw it a block. It catches it and throws it back to you. Throw one through the hoop: the PC page's scoreboard shows the point too.
7. Open the perf HUD (X) and check it holds 90 Hz.
