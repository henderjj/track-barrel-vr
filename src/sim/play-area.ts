/**
 * The play area's main dimensions, shared by the procedural model
 * (src/scene-assets/deck.scene-asset.ts), the systems and the engine-free
 * simulation. Deck space: deck surface at y = 0, the start screen faces
 * -Z, +X to the player's right.
 *
 * Change these for your game; the deck walk bounds, the z-fighting test and
 * the practice crewmate's spots all follow them.
 */

export const DECK_WIDTH = 3.0;
export const DECK_LENGTH = 4.0;
/** The top rail runs round the deck this high above it, m. */
export const RAIL_HEIGHT = 1.0;

/** A waist-high table at the far end, where the blocks start (middle x, z; top height; width, depth), m. */
export const TABLE = { x: 0, z: -1.2, height: 0.8, width: 1.0, depth: 0.5 } as const;

/** The hoop the crew throw blocks through for points: its middle and its inner radius, m. It faces along Z. */
export const HOOP = { x: 0, y: 2.0, z: -2.6, radius: 0.35 } as const;

/** Where each player stands when the game starts: the host at the near end, the crewmate across the table (x, z). */
export const HOST_SPOT = [0, 0.9] as const;
export const CREW_SPOT = [0.6, -0.3] as const;

/** The grass ground around the raised deck, m (the deck surface is y = 0). */
export const GROUND_Y = -0.4;
