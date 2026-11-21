import { BoxGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from '@iwsdk/core';
import { litInside } from './cabin-light.js';
import { CASE_CLIPPED, CASE_HALF, MAP_CASE, RIGHT_WALL } from '../sim/map-case.js';
import { mergeParts, type Part } from './lowpoly.js';

/**
 * The commander's map case (F2.10, docs/map-case.md): a stiff board in a
 * leather frame, the field map in its window, and the clips on the
 * turret's right wall it hangs on. Sizes from src/sim/map-case.ts. The case
 * is its own mesh (MapCaseSystem moves it between the wall and the hand);
 * the map is a separate unlit sheet MapCaseSystem paints; the clips are
 * merged into the turret's mesh (cabin.scene-asset.ts). Low-poly,
 * vertex-coloured.
 */

const LEATHER = 0x5b3c22;
const BOARD = 0x3e2a17;
const CLIP = 0x2b2e2a;

/** The frame's front, case z: in front of the map by frameGap. */
export function frameFront(): number {
  return MAP_CASE.thick / 2 + MAP_CASE.sheetGap + MAP_CASE.frameGap;
}

/** The case, in its own space: the board and the leather frame round the map's window. */
export function createMapCase(): Mesh {
  const { sheet, border, thick } = MAP_CASE;
  const half = CASE_HALF;
  const front = frameFront();
  const back = -thick / 2;
  const depth = front - back;
  const mid = (front + back) / 2;
  const bar = (w: number, h: number, x: number, y: number): Part => ({ geometry: new BoxGeometry(w, h, depth), color: LEATHER, position: [x, y, mid] });
  const parts: Part[] = [
    { geometry: new BoxGeometry(sheet, sheet, thick), color: BOARD, position: [0, 0, 0] },
    bar(2 * half, border, 0, sheet / 2 + border / 2),
    bar(2 * half, border, 0, -sheet / 2 - border / 2),
    bar(border, sheet, sheet / 2 + border / 2, 0),
    bar(border, sheet, -sheet / 2 - border / 2, 0),
  ];
  const mesh = new Mesh(mergeParts(parts), litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }), { finish: true }));
  mesh.name = 'Map Case';
  return mesh;
}

/** The map's sheet, in the case's space: facing +Z, sheetGap in front of the board. MapCaseSystem gives it the painted map. */
export function createMapSheet(): Mesh {
  const geometry = new PlaneGeometry(MAP_CASE.sheet, MAP_CASE.sheet);
  geometry.translate(0, 0, MAP_CASE.thick / 2 + MAP_CASE.sheetGap);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: 0xe6e6e6, toneMapped: false }));
  mesh.name = 'Map Sheet';
  return mesh;
}

/**
 * The clips the case hangs on, in turret space, for the turret's mesh: two
 * small shelves under its bottom edge and a spring clip over its top edge,
 * each from the wall out past the case's front.
 */
export function mapClipParts(): Part[] {
  const c = CASE_CLIPPED;
  const caseFront = frameFront();
  // Out from the wall (turret −x) to 4 mm past the case's frame.
  const outer = c.x - caseFront - 0.004;
  const reach = RIGHT_WALL + 0.01 - outer;
  const midX = (RIGHT_WALL + 0.01 + outer) / 2;
  const shelf = (z: number): Part => ({ geometry: new BoxGeometry(reach, 0.008, 0.03), color: CLIP, position: [midX, c.y - CASE_HALF - 0.004 - 0.001, z] });
  return [
    shelf(c.z - CASE_HALF * 0.6),
    shelf(c.z + CASE_HALF * 0.6),
    { geometry: new BoxGeometry(reach, 0.008, 0.04), color: CLIP, position: [midX, c.y + CASE_HALF + 0.004 + 0.001, c.z] },
  ];
}
