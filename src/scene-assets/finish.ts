import type { Finish } from './lowpoly.js';

/**
 * The cabin's finishes (docs/interior.md, "Shapes and materials"): how each
 * kind of surface inside the tank takes the light, as gloss and metalness
 * (src/scene-assets/lowpoly.ts's `Finish`). Painted plates are a dull satin,
 * machined and worn steel has a metal sheen, brass cases shine, rubber and
 * leather are a little glossy, wood is matte. A model module maps its own
 * colours to these with `finishTable` and passes the table to `mergeParts`;
 * its material is `litInside(..., { finish: true })`. One finish per colour,
 * so two faces z-fighting test lets share a plane (same colour) never light
 * differently.
 */
export const FINISH = {
  /** The ivory and olive paint: satin, so a lamp's pool shows on it. */
  paint: [0.18, 0],
  /** Cast or forged parts painted over: a little duller than plate. */
  casting: [0.12, 0],
  /** Blued or oiled steel: the guns' and the controls' working parts. */
  steel: [0.42, 0.55],
  /** Steel worn bright by hands and shells. */
  bright: [0.55, 0.8],
  /** Cartridge brass and copper bands. */
  brass: [0.6, 0.85],
  rubber: [0.28, 0],
  leather: [0.38, 0],
  wood: [0.08, 0],
} as const satisfies Record<string, Finish>;

/** A `finishOf` for `mergeParts` from a table of colours: any colour not in it is matte. */
export function finishTable(table: ReadonlyArray<readonly [color: number, finish: Finish]>): (color: number) => Finish | undefined {
  const map = new Map<number, Finish>(table.map(([c, f]) => [c, f]));
  return (color) => map.get(color);
}

/**
 * The colours the tank's inside is painted and made in, shared by the
 * cabin's models (cabin.scene-asset.ts and the modules merged into it, the
 * driver's station, loading, the mechanism kit's controls).
 */
export const INTERIOR_COLORS = {
  paint: 0x8f8a5c,
  paintDark: 0x6f6b47,
  ivory: 0xe6dcc0,
  ivoryShade: 0xcfc5a8,
  /** Cast housings painted ivory, a shade greyer than the plate. */
  casting: 0xbcb39a,
  floor: 0x55534c,
  basket: 0x6a6860,
  olive: 0x5d5f45,
  oliveDark: 0x4a4a32,
  radio: 0x55594a,
  steel: 0x3c3d3f,
  steelLight: 0x5b5d60,
  bright: 0x8a9094,
  dark: 0x2a2a26,
  leather: 0x5a3d26,
  rubber: 0x1e1e1e,
  red: 0xa8281c,
  brass: 0xb08a3c,
  primer: 0x3a3024,
} as const;

const I = INTERIOR_COLORS;

/**
 * Every colour drawn inside the tank (and on its outside, painted) with
 * its finish: the shared palette above and the colours the other cabin
 * models name for themselves. Any colour not here is matte.
 */
export const interiorFinish = finishTable([
  // Paint, inside and out.
  [I.paint, FINISH.paint],
  [I.paintDark, FINISH.paint],
  [I.ivory, FINISH.paint],
  [I.ivoryShade, FINISH.paint],
  [I.olive, FINISH.paint],
  [I.oliveDark, FINISH.paint],
  [I.radio, FINISH.paint],
  [I.basket, FINISH.casting],
  [I.floor, FINISH.casting],
  [I.casting, FINISH.casting],
  [I.red, [0.4, 0]],
  [0x8a2c22, [0.35, 0]], // the breech lever's red
  [0x4b5320, FINISH.paint], // the mechanism kit's olive
  [0x363c18, FINISH.paint],
  [0x4b4a3c, FINISH.paint], // the casing bin
  // Steel.
  [I.steel, FINISH.steel],
  [I.steelLight, FINISH.steel],
  [I.dark, FINISH.steel],
  [0x55595e, FINISH.steel],
  [0x3d4145, FINISH.steel],
  [0x3a3f42, FINISH.steel],
  [0x2b2e2a, FINISH.steel],
  [0x34322e, FINISH.steel],
  [0x4a5148, FINISH.steel],
  [0x2f3430, FINISH.steel],
  [I.bright, FINISH.bright],
  [0x7b8388, FINISH.bright], // the breech block
  // Brass and copper.
  [I.brass, FINISH.brass],
  [0xc9a03a, FINISH.brass],
  [0xb0643a, FINISH.brass],
  // Rubber, leather, wood.
  [I.rubber, FINISH.rubber],
  [0x1c1c1c, FINISH.rubber],
  [I.leather, FINISH.leather],
  [0x7a5534, FINISH.wood],
  [0x7a5a35, FINISH.wood],
]);
