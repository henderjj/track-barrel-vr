import { PosedHand } from './hand.scene-asset.js';

/**
 * The crew's colours and gauntlets. The crewmate is drawn as the textured
 * crewman (src/scene-assets/crewman.ts, F6.3b, docs/crew-avatars.md), a
 * British Royal Armoured Corps tank crewman of 1944; its hands are these
 * posable leather gauntlets, drawn at the controllers' grip poses and locked
 * onto what they hold, with the forearms reaching into their cuffs.
 *
 * The crew colour (the menu's swatches) is the crewman's neckerchief and the
 * gauntlets' cuff bands, so the two crew tell each other apart in matching
 * uniforms.
 */

export const CREW_COLORS = [0x2f6db3, 0xc0563a, 0x3f8f5a, 0x8a4fb0, 0xd19a2a, 0x2a9a9a, 0x9a3a5a, 0x5a5a5a];
/** Names for the crew colours (the neckerchief), for the crew panel. */
export const CREW_COLOR_NAMES = ['Blue', 'Brick', 'Green', 'Plum', 'Mustard', 'Teal', 'Wine', 'Slate'];

/** Crew colour `index` as hex (the neckerchief and the gauntlets' cuff bands). */
export function crewCoat(index: number): number {
  return CREW_COLORS[index % CREW_COLORS.length];
}

/** A posable leather gauntlet, for the crewman's forearm to reach into, with a cuff band in crew colour `index`, for drawing at a grip pose. */
export function createAvatarHand(index: number, side: 'left' | 'right'): PosedHand {
  const hand = new PosedHand(CREW_COLORS[index % CREW_COLORS.length], side);
  hand.mesh.name = `Crew ${index + 1} ${side === 'left' ? 'Left' : 'Right'} Hand`;
  return hand;
}
