# Findings from Patchwork Airship VR

These notes are the early experiments (spikes) from the game this template came from, a co-op airship game. Each one tried a risky piece on real headsets and recorded what worked, what didn't, and the numbers. They describe the airship, but the parts kept in this template work the same way, so they are the background to why the code is as it is.

| Note | What it settled |
| --- | --- |
| [s4-networking.md](s4-networking.md) | Peer-to-peer WebRTC through a small lobby, binary pose packets on an unreliable channel, interpolation delay and clock sync |
| [s5-voice.md](s5-voice.md) | Voice on the same connection, positioned at the crewmate's head, echo cancellation with spatial audio |
| [s7-throwing.md](s7-throwing.md) | Throwing and catching at 150 ms: the holder owns an object, the thrower keeps simulating until the catch |
| [s8-pcvr.md](s8-pcvr.md) | PC VR over Link and Air Link in Chrome and Edge, measured refresh rate, the graphics acceleration trap |
| [s9-hand-tracking.md](s9-hand-tracking.md) | Tracked hands gripping with a fist or a pinch |
| [s10-session-lifecycle.md](s10-session-lifecycle.md) | What happens when a headset sleeps, a tab hides, the network drops or a player leaves, and reconnecting |

References in them to the ship, the gondola, the crank, the rope or fuel bricks are to the airship's code, which isn't in this template.

## Track & Barrel spikes

The spikes in the [plan](../plan.md#5-risks-and-spikes) for this game, numbered S1 to S4 there.

| Note | What it settles |
| --- | --- |
| [s3-lever-feel.md](s3-lever-feel.md) | A hand-following lever with limits, springing back, with controllers and tracked hands, tried on a lane |
