import { PhysicsSystem, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { preferHighPerformanceGpu } from './gpu-preference.js';
import { BodyHeightSystem } from './systems/body-height-system.js';
import { CrewBotSystem } from './systems/crew-bot-system.js';
import { CrewStatusSystem } from './systems/crew-status-system.js';
import { FrameRateSystem } from './systems/frame-rate-system.js';
import { GameMenuSystem } from './systems/game-menu-system.js';
import { GripSystem } from './systems/grip-system.js';
import { LoadingDrillSystem } from './systems/loading-drill-system.js';
import { LeverSystem } from './systems/lever-system.js';
import { NetSystem } from './systems/net-system.js';
import { OwnHandsSystem } from './systems/own-hands-system.js';
import { PerfHudSystem } from './systems/perf-hud-system.js';
import { PlatformSystem } from './systems/platform-system.js';
import { RideSystem } from './systems/ride-system.js';
import { SeatSystem } from './systems/seat-system.js';
import { SightSystem } from './systems/sight-system.js';
import { StartScreenSystem } from './systems/start-screen-system.js';

// On a two-GPU PC, start on the graphics card Link uses (src/gpu-preference.ts).
preferHighPerformanceGpu();

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  // The perf HUD runs first so it can time everything after it.
  world.registerSystem(PerfHudSystem, { priority: -100 });
  world.registerSystem(FrameRateSystem);
  // Before anything reads the head or hands: it raises or lowers the player for their character's height.
  world.registerSystem(BodyHeightSystem, { priority: -6 });
  // Just after it: it puts the player in their seat, on top of the body-height offset.
  world.registerSystem(SeatSystem, { priority: -6 });
  // Before the systems that read its grip state.
  world.registerSystem(GripSystem, { priority: -5 });
  world.registerSystem(NetSystem);
  // Spike S2: before anything draws the hands on the moved rig. The seat system stands aside while it rides.
  world.registerSystem(RideSystem);
  // After NetSystem, which updates the crew presence it shows.
  world.registerSystem(CrewStatusSystem);
  // Add the tank's systems here. ThrowablesSystem (loose objects, kept for
  // shells and casings) goes after any that hold a hand (handUse), since it
  // skips hands already holding something.
  world.registerSystem(LeverSystem);
  world.registerSystem(LoadingDrillSystem);
  // After the systems it drives; their scripted hands are functions of time, so a frame late costs nothing.
  world.registerSystem(CrewBotSystem);
  // After the controls have moved, so hands drawn on them (grip locking) sit on them this frame.
  world.registerSystem(OwnHandsSystem);
  // Spike S1's gunsight renders its view once everything in it has moved this frame.
  world.registerSystem(SightSystem);
  // After NetSystem, which may have joined a crew from the page's link.
  world.registerSystem(StartScreenSystem);
  world.registerSystem(GameMenuSystem);
  world.registerSystem(PlatformSystem);
  // Handles for the automated XR tests.
  (window as unknown as { __debug: unknown }).__debug = { world, PhysicsSystem };
});
