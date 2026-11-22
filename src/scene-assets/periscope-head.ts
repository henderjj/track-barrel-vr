import { BoxGeometry, CylinderGeometry } from '@iwsdk/core';
import type { Part } from './lowpoly.js';
import { HEAD_SIZE } from '../sim/periscope.js';

/**
 * A crew periscope's head standing out of the roof (docs/exterior.md,
 * "Periscope heads"), in its own space: the upright at x = z = 0, y as
 * given. It reads as an M6 periscope in its mount: the round rotor on the
 * roof, the head's body with its dark window looking along -Z, and a hood
 * over the window (a brow forward from the top, a cheek either side), all
 * painted the hull's colour. The driver's and the gunner's (periscope.scene-asset.ts)
 * and the assistant driver's fixed one (exterior.scene-asset.ts) share it, so all three match.
 */

/** The tank's paint outside, and its darker shade (cabin.scene-asset.ts's PAINT and PAINT_DARK). */
const PAINT = 0x8f8a5c;
const PAINT_DARK = 0x6f6b47;
const GLASS = 0x1a2630;

/** The rotor on the roof the head turns in: its radius and how far it stands over the roof's top, m. */
export const HEAD_ROTOR = { radius: 0.068, height: 0.018 } as const;
/** The hood over the window: how far the brow and cheeks reach ahead of the head's front, how thick they are, m. */
export const HEAD_HOOD = { ahead: 0.024, brow: 0.014, cheek: 0.008 } as const;
/** The window on the head's front: its width and height, m. */
export const HEAD_WINDOW = { width: 0.07, height: 0.035 } as const;

/**
 * The head from `bottom` (inside the roof plate, 1 cm under its top) to
 * `top`, head space. `windowY` is the window's middle (the periscope
 * camera's height). Each part is offset by `at`.
 */
export function periscopeHeadParts(bottom: number, top: number, windowY: number, at: readonly [number, number, number] = [0, 0, 0]): Part[] {
  const { width, depth } = HEAD_SIZE;
  const roofTop = bottom + 0.01;
  const front = -depth / 2;
  const bodyTop = top - HEAD_HOOD.brow;
  const parts: Part[] = [
    // The rotor: a low round collar on the roof.
    // Its foot 9 mm under the body's (faces 8 mm apart never flicker), both inside the roof plate.
    { geometry: new CylinderGeometry(HEAD_ROTOR.radius, HEAD_ROTOR.radius + 0.006, roofTop + HEAD_ROTOR.height - bottom + 0.009, 16, 1), color: PAINT_DARK, position: [0, (bottom - 0.009 + roofTop + HEAD_ROTOR.height) / 2, 0] },
    // The body, its top inside the brow.
    { geometry: new BoxGeometry(width, bodyTop + 0.004 - bottom, depth), color: PAINT, position: [0, (bottom + bodyTop + 0.004) / 2, 0] },
    // The brow: a plate over the body, reaching out over the window.
    {
      geometry: new BoxGeometry(width + 2 * HEAD_HOOD.cheek, HEAD_HOOD.brow, depth + HEAD_HOOD.ahead + 0.004),
      color: PAINT,
      position: [0, top - HEAD_HOOD.brow / 2, (HEAD_HOOD.ahead - 0.004) / -2],
    },
    // The window, dark glass standing 1 cm proud of the front (clear of it in depth), under the hood.
    { geometry: new BoxGeometry(HEAD_WINDOW.width, HEAD_WINDOW.height, 0.01), color: GLASS, position: [0, windowY, front - 0.005] },
  ];
  // The cheeks, down either side of the window from the brow.
  const cheekBottom = Math.max(roofTop + HEAD_ROTOR.height + 0.004, windowY - HEAD_WINDOW.height / 2 - 0.012);
  const cheekTop = top - HEAD_HOOD.brow + 0.004;
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new BoxGeometry(HEAD_HOOD.cheek, cheekTop - cheekBottom, HEAD_HOOD.ahead + 0.006),
      color: PAINT,
      position: [side * (width / 2 + HEAD_HOOD.cheek / 2), (cheekTop + cheekBottom) / 2, front - HEAD_HOOD.ahead / 2 + 0.003],
    });
  }
  return parts.map((p) => ({ ...p, position: [(p.position?.[0] ?? 0) + at[0], (p.position?.[1] ?? 0) + at[1], (p.position?.[2] ?? 0) + at[2]] }));
}
