import { CanvasTexture, Mesh, MeshStandardMaterial, SRGBColorSpace } from '@iwsdk/core';
import { cssColor, LABEL_ATLAS, signLabelAtlas, signLabelGeometry, signLabels } from '../scene-assets/course.scene-asset.js';
import { TILE } from '../sim/terrain.js';

/** The road-sign typeface (Overpass, OFL, after the US highway signs' letters) and where it is. */
const FAMILY = 'Overpass';
const FILE = 'fonts/Overpass-ExtraBold.woff2';
const WEIGHT = '800';
const FONT = `${WEIGHT} {px}px '${FAMILY}', 'Arial Narrow', Arial, sans-serif`;

/** Each copy of the ground's tiles the course is drawn on (terrain.scene-asset.ts: three by three). */
const COPIES: readonly (readonly [number, number])[] = [-1, 0, 1].flatMap((tx) => [-1, 0, 1].map((tz) => [tx * TILE, tz * TILE] as const));

/**
 * The words on the biathlon course's signs (docs/biathlon-signs.md): one
 * canvas with every label drawn in a road-sign typeface, and one mesh of
 * quads laying each over its sign's face on every copy of the course, for
 * CourseSystem to hang on the ground. Drawn once in the fallback face and
 * again when the typeface has loaded. One draw call.
 */
export function createSignLabels(): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_ATLAS.width;
  canvas.height = LABEL_ATLAS.height;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  // Lit as the signs' faces are (the ground's material); only the letters show, the face round them its own.
  const material = new MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0, flatShading: true, transparent: true, depthWrite: false });
  const mesh = new Mesh(signLabelGeometry(COPIES), material);
  mesh.name = 'Sign Labels';
  const draw = () => {
    drawLabels(ctx);
    texture.needsUpdate = true;
  };
  draw();
  if (typeof FontFace !== 'undefined') {
    new FontFace(FAMILY, `url(${import.meta.env.BASE_URL}${FILE})`, { weight: WEIGHT })
      .load()
      .then((face) => {
        document.fonts.add(face);
        draw();
      })
      .catch((error: unknown) => console.warn(`[Course] the signs' typeface didn't load, drawing in the fallback: ${String(error)}`));
  }
  return mesh;
}

/** Every label into its place in the canvas: its lines as large as fit, centred, on nothing (the sign's face shows round them). */
function drawLabels(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, LABEL_ATLAS.width, LABEL_ATLAS.height);
  for (const [kind, rects] of signLabelAtlas()) {
    signLabels(kind).forEach((label, k) => {
      const [x, y, w, h] = rects[k];
      const n = label.lines.length;
      // Capitals about 70% of a line's height: Overpass's cap height is about 0.7 of its size.
      let px = Math.floor((h / n) * 0.98);
      ctx.font = FONT.replace('{px}', String(px));
      const widest = Math.max(...label.lines.map((t) => ctx.measureText(t).width));
      if (widest > w * 0.94) {
        px = Math.floor((px * w * 0.94) / widest);
        ctx.font = FONT.replace('{px}', String(px));
      }
      ctx.fillStyle = cssColor(label.ink);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      label.lines.forEach((line, i) => {
        // Nudged down a little: 'middle' centres the em box, which sits above capitals' middle.
        ctx.fillText(line, x + w / 2, y + (h / n) * (i + 0.5) + px * 0.06);
      });
    });
  }
}
