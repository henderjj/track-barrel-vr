import { Bone, BufferAttribute, BufferGeometry, Color, Vector3 } from '@iwsdk/core';
import { FINISH } from './finish.js';
import type { Finish } from './lowpoly.js';

/**
 * The low-poly crewman (F6.3c, docs/crew-avatars.md): the crewmate drawn as
 * a British Royal Armoured Corps tank crewman of 1944, built here in code,
 * faceted and vertex-coloured, as one skinned mesh and a headgear mesh.
 *
 * He is made sitting, as he is always drawn: hips on the seat's hip point
 * at the origin, facing +Z, his left towards +X, thighs along the cushion,
 * shins down to a floor 0.56 m below (the seats' hip height) and arms
 * forward to the controls. `Crewman` (crewman.ts) poses his bones from the
 * crewmate's head and hands, so the shapes only bend a little from here.
 *
 * Each part is a loft: rings of points around a bone's line, joined into
 * facets. A ring's points follow the bones it sits between (two-bone
 * skinning, blended across the joints), so elbows, knees and the waist
 * bend without tearing. Clothing is coloured onto the same surface where
 * one garment meets another (no layers to flicker), and the pieces that
 * stand proud (belt, buttons, collar, holster, anklets, beret band, badge,
 * headset) sit at least 3 mm off whatever is under them.
 *
 * What he wears (docs/crew-avatars.md, "What he wears"): a black RAC beret
 * pulled down to the right with a white-metal badge over the left eye, a
 * wireless headset over it; a battledress blouse and trousers in khaki
 * serge with its collar at the neck and a neckerchief in the crew colour;
 * a sleeveless leather jerkin buttoned over it; '37 pattern webbing: a belt
 * with a brass buckle, a pistol holster on the right hip and an ammunition
 * pouch; webbing anklets over black ammunition boots. His hands are the
 * posable gauntlets (`PosedHand`), drawn at the controllers.
 */

type V3 = readonly [number, number, number];

/** A vertex's skinning: bone `a`, bone `b`, and the share `w` of `b` (0 to 1). */
type Skin = readonly [a: number, b: number, w: number];

/** The bones, in skin-index order: name, parent index, and the joint's place as made (m). */
const BONES: ReadonlyArray<readonly [name: string, parent: number, at: V3]> = [
  ['pelvis', -1, [0, 0, 0]],
  ['spine_01', 0, [0, 0.1, -0.03]],
  ['spine_02', 1, [0, 0.25, -0.04]],
  ['spine_03', 2, [0, 0.4, -0.045]],
  ['neck_01', 3, [0, 0.555, -0.05]],
  ['Head', 4, [0, 0.675, -0.04]],
  ['upperarm_l', 3, [0.18, 0.49, -0.05]],
  ['lowerarm_l', 6, [0.21, 0.24, 0.09]],
  ['hand_l', 7, [0.18, 0.28, 0.345]],
  ['upperarm_r', 3, [-0.18, 0.49, -0.05]],
  ['lowerarm_r', 9, [-0.21, 0.24, 0.09]],
  ['hand_r', 10, [-0.18, 0.28, 0.345]],
  ['thigh_l', 0, [0.09, 0, 0]],
  ['calf_l', 12, [0.1, -0.01, 0.44]],
  ['foot_l', 13, [0.1, -0.47, 0.41]],
  ['ball_l', 14, [0.1, -0.54, 0.54]],
  ['thigh_r', 0, [-0.09, 0, 0]],
  ['calf_r', 16, [-0.1, -0.01, 0.44]],
  ['foot_r', 17, [-0.1, -0.47, 0.41]],
  ['ball_r', 18, [-0.1, -0.54, 0.54]],
];

/** The bones' names, in skin-index order. */
export const CREWMAN_BONES: readonly string[] = BONES.map((b) => b[0]);
const B = Object.fromEntries(BONES.map((b, i) => [b[0], i])) as Record<string, number>;

/** Between the eyes, as made (facing +Z, hips at the origin), m. */
export const CREWMAN_EYES: V3 = [0, 0.715, 0.03];
/** The floor under his boots as made, from the hips, m (the seats' hip height). */
export const CREWMAN_FLOOR = -0.56;

/** The colours he is made in. */
export const CREWMAN_COLORS = {
  skin: 0xd6a283,
  lips: 0xb07462,
  hair: 0x4a3627,
  brow: 0x33261b,
  sclera: 0xd9d0c3,
  iris: 0x3e3024,
  beret: 0x1b1b21,
  binding: 0x111114,
  badge: 0xc9c7bd,
  headset: 0x232120,
  headsetBand: 0x3a3836,
  serge: 0x75694a,
  collar: 0x6b6043,
  jerkin: 0x684530,
  jerkinEdge: 0x523522,
  button: 0x2b2017,
  webbing: 0x968f63,
  webbingDark: 0x817a52,
  brass: 0xb59446,
  boot: 0x1f1b18,
  sole: 0x2d2824,
} as const;
const C = CREWMAN_COLORS;

const FINISHES = new Map<number, Finish>([
  [C.jerkin, FINISH.leather],
  [C.jerkinEdge, FINISH.leather],
  [C.boot, [0.45, 0]],
  [C.headset, FINISH.rubber],
  [C.badge, FINISH.bright],
  [C.brass, FINISH.brass],
  [C.button, FINISH.rubber],
  [C.sclera, [0.3, 0]],
  [C.iris, [0.5, 0]],
]);

const tmpColor = new Color();

/** Triangles with colours, finishes and skinning, gathered into one geometry. */
class Mesher {
  readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly finishes: number[] = [];
  private readonly skinIndex: number[] = [];
  private readonly skinWeight: number[] = [];

  /** One triangle, wound anticlockwise seen from outside. */
  tri(a: V3, b: V3, c: V3, color: number, sa: Skin, sb: Skin = sa, sc: Skin = sa): void {
    tmpColor.setHex(color);
    const finish = FINISHES.get(color) ?? [0, 0];
    for (const [p, s] of [
      [a, sa],
      [b, sb],
      [c, sc],
    ] as const) {
      this.positions.push(p[0], p[1], p[2]);
      this.colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
      this.finishes.push(finish[0], finish[1]);
      this.skinIndex.push(s[0], s[1], 0, 0);
      this.skinWeight.push(1 - s[2], s[2], 0, 0);
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, color: number, s: Skin): void {
    this.tri(a, b, c, color, s);
    this.tri(a, c, d, color, s);
  }

  geometry(skinned: boolean): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    g.setAttribute('finish', new BufferAttribute(new Float32Array(this.finishes), 2));
    if (skinned) {
      g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(this.skinIndex), 4));
      g.setAttribute('skinWeight', new BufferAttribute(new Float32Array(this.skinWeight), 4));
    }
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// --- small vector sums on tuples (made once, at build time) ---

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mirrorX = (a: V3): V3 => [-a[0], a[1], a[2]];

/** One ring of a loft: its centre, half-width (along the side axis) and half-depth, and the bones its points follow. */
interface Ring {
  c: V3;
  rx: number;
  rz: number;
  skin: Skin;
  /** Squareness: 2 is an ellipse, more is boxier. */
  n?: number;
  /** A multiplier on the radius at each angle (0 is the side axis, π/2 the front), for shaping. */
  shape?: (theta: number) => number;
}

interface LoftOptions {
  sides: number;
  /** Which way the rings' angle 0 points, roughly (made square to the loft's line). */
  side: V3;
  /** Turn of the first point from the side axis, rad. */
  phase?: number;
  /** A facet's colour from its ring segment, its column, and its middle angle and place. */
  color: number | ((segment: number, column: number, theta: number, at: V3) => number);
  /** Close the first or last ring with a fan to a point this far beyond it along the line (m), coloured so. */
  capStart?: { out: number; color: number };
  capEnd?: { out: number; color: number };
  /** Leave facets out (an open collar's front). */
  skip?: (segment: number, column: number, theta: number) => boolean;
  /** Face the facets inwards (a collar's inside). */
  inward?: boolean;
}

/** The points of a loft's rings, for fitting things to it. */
type Loft = V3[][];

function superAxis(v: number, n: number): number {
  return Math.sign(v) * Math.abs(v) ** (2 / n);
}

function loft(m: Mesher, rings: readonly Ring[], o: LoftOptions): Loft {
  const N = o.sides;
  const points: V3[][] = [];
  const tangents: V3[] = [];
  for (let i = 0; i < rings.length; i++) {
    const prev = rings[Math.max(0, i - 1)].c;
    const next = rings[Math.min(rings.length - 1, i + 1)].c;
    const t = norm(sub(next, prev));
    tangents.push(t);
    const side = norm(sub(o.side, mul(t, dot(o.side, t))));
    const front = cross(side, t);
    const r = rings[i];
    const ring: V3[] = [];
    for (let k = 0; k < N; k++) {
      const theta = (o.phase ?? 0) + (2 * Math.PI * k) / N;
      const s = r.shape ? r.shape(theta) : 1;
      const n = r.n ?? 2;
      const x = superAxis(Math.cos(theta), n) * r.rx * s;
      const z = superAxis(Math.sin(theta), n) * r.rz * s;
      ring.push(add(r.c, add(mul(side, x), mul(front, z))));
    }
    points.push(ring);
  }
  const colorOf = (seg: number, k: number, at: V3) => {
    const theta = (o.phase ?? 0) + (2 * Math.PI * (k + 0.5)) / N;
    return typeof o.color === 'number' ? o.color : o.color(seg, k, theta, at);
  };
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < N; k++) {
      const k1 = (k + 1) % N;
      const theta = (o.phase ?? 0) + (2 * Math.PI * (k + 0.5)) / N;
      if (o.skip?.(i, k, theta)) continue;
      const a = points[i][k];
      const b = points[i][k1];
      const c = points[i + 1][k1];
      const d = points[i + 1][k];
      const color = colorOf(i, k, mul(add(add(a, b), add(c, d)), 0.25));
      const sa = rings[i].skin;
      const sc = rings[i + 1].skin;
      if (o.inward) {
        m.tri(a, b, c, color, sa, sa, sc);
        m.tri(a, c, d, color, sa, sc, sc);
      } else {
        m.tri(a, c, b, color, sa, sc, sa);
        m.tri(a, d, c, color, sa, sc, sc);
      }
    }
  }
  if (o.capStart) {
    const r = rings[0];
    const tip = sub(r.c, mul(tangents[0], o.capStart.out));
    for (let k = 0; k < N; k++) m.tri(tip, points[0][k], points[0][(k + 1) % N], o.capStart.color, r.skin);
  }
  if (o.capEnd) {
    const last = rings.length - 1;
    const r = rings[last];
    const tip = add(r.c, mul(tangents[last], o.capEnd.out));
    for (let k = 0; k < N; k++) m.tri(tip, points[last][(k + 1) % N], points[last][k], o.capEnd.color, r.skin);
  }
  return points;
}

/**
 * A ring around an upright loft at height `at(k)` (m, as made) on each
 * column k, pushed out from it by `out` (m): for bands that hug a surface
 * (a belt, the beret's band).
 */
function hugRing(l: Loft, at: (column: number) => number, out: number, centreOf: (p: V3) => V3): V3[] {
  const N = l[0].length;
  const ring: V3[] = [];
  for (let k = 0; k < N; k++) {
    const y = at(k);
    let seg = 0;
    while (seg < l.length - 2 && l[seg + 1][k][1] < y) seg++;
    const t = (y - l[seg][k][1]) / (l[seg + 1][k][1] - l[seg][k][1]);
    const p = lerp3(l[seg][k], l[seg + 1][k], t);
    const c = centreOf(p);
    const radial = sub(p, c);
    ring.push(add(p, mul(norm(radial), out)));
  }
  return ring;
}

/** A level ring of `sides` points round `c`, half-width `rx` and half-depth `rz` (for bands round a near-upright part). */
function ring(c: V3, rx: number, rz: number, sides: number): V3[] {
  return Array.from({ length: sides }, (_, k) => {
    const a = (2 * Math.PI * k) / sides;
    return [c[0] + Math.cos(a) * rx, c[1], c[2] + Math.sin(a) * rz] as V3;
  });
}

/** Join two rings of the same count into a band of facets. */
function band(m: Mesher, lower: readonly V3[], upper: readonly V3[], color: number | ((k: number) => number), skin: Skin | ((p: V3) => Skin)): void {
  const N = lower.length;
  for (let k = 0; k < N; k++) {
    const k1 = (k + 1) % N;
    const col = typeof color === 'number' ? color : color(k);
    const s = (p: V3) => (typeof skin === 'function' ? skin(p) : skin);
    m.tri(lower[k], upper[k1], lower[k1], col, s(lower[k]), s(upper[k1]), s(lower[k1]));
    m.tri(lower[k], upper[k], upper[k1], col, s(lower[k]), s(upper[k]), s(upper[k1]));
  }
}

/**
 * A flat plate standing `proud` (m) off a surface at `at` with outward
 * normal `normal`, its outline `outline` (2D, m, x along `right`), sunk
 * `sink` behind the surface so its edges never show a gap: a button, a
 * badge, an eyebrow, an eye.
 */
function plate(
  m: Mesher,
  at: V3,
  normal: V3,
  upHint: V3,
  outline: ReadonlyArray<readonly [number, number]>,
  proud: number,
  sink: number,
  color: number | ((i: number) => number),
  skin: Skin,
  centre?: { radius: number; color: number },
): void {
  const n = norm(normal);
  const right = norm(cross(upHint, n));
  const up = cross(n, right);
  const on = (x: number, y: number, h: number): V3 => add(at, add(add(mul(right, x), mul(up, y)), mul(n, h)));
  const count = outline.length;
  const face = (x: number, y: number) => on(x, y, proud);
  const middle = face(0, 0);
  for (let i = 0; i < count; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % count];
    const col = typeof color === 'number' ? color : color(i);
    if (centre) {
      // An iris: the middle of the face in another colour, in the same plane.
      const s = centre.radius;
      const r0 = Math.hypot(x0, y0);
      const r1 = Math.hypot(x1, y1);
      const in0 = face((x0 / r0) * s, (y0 / r0) * s);
      const in1 = face((x1 / r1) * s, (y1 / r1) * s);
      m.tri(middle, in0, in1, centre.color, skin);
      m.quad(in0, face(x0, y0), face(x1, y1), in1, col, skin);
    } else {
      m.tri(middle, face(x0, y0), face(x1, y1), col, skin);
    }
    // The edge, down into the surface.
    m.quad(on(x0, y0, -sink), on(x1, y1, -sink), on(x1, y1, proud), on(x0, y0, proud), col, skin);
  }
}

/** A box from its centre, half sizes along three axes, as facets. */
function box(m: Mesher, centre: V3, axes: readonly [V3, V3, V3], half: V3, color: number | ((face: number) => number), skin: Skin): void {
  const [ax, ay, az] = axes.map(norm) as unknown as [V3, V3, V3];
  const corner = (sx: number, sy: number, sz: number): V3 => add(centre, add(add(mul(ax, sx * half[0]), mul(ay, sy * half[1])), mul(az, sz * half[2])));
  const faces: ReadonlyArray<readonly [V3, V3, V3, V3]> = [
    [corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(1, -1, 1)],
    [corner(-1, -1, 1), corner(-1, 1, 1), corner(-1, 1, -1), corner(-1, -1, -1)],
    [corner(-1, 1, -1), corner(-1, 1, 1), corner(1, 1, 1), corner(1, 1, -1)],
    [corner(-1, -1, 1), corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1)],
    [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)],
    [corner(1, -1, -1), corner(-1, -1, -1), corner(-1, 1, -1), corner(1, 1, -1)],
  ];
  // Each face wound anticlockwise from outside when the axes are right-handed.
  const handed = dot(cross(ax, ay), az) > 0;
  faces.forEach((f, i) => {
    const col = typeof color === 'number' ? color : color(i);
    if (handed) m.quad(f[0], f[1], f[2], f[3], col, skin);
    else m.quad(f[3], f[2], f[1], f[0], col, skin);
  });
}

/** Where a ray from `from` along `dir` first meets the triangles `tris` (flat array, 9 a triangle), and that face's normal. */
function hit(tris: readonly number[], from: V3, dir: V3): { at: V3; normal: V3 } {
  let best = Infinity;
  let normal: V3 = [0, 0, 1];
  for (let t = 0; t < tris.length; t += 9) {
    const a: V3 = [tris[t], tris[t + 1], tris[t + 2]];
    const e1 = sub([tris[t + 3], tris[t + 4], tris[t + 5]], a);
    const e2 = sub([tris[t + 6], tris[t + 7], tris[t + 8]], a);
    const p = cross(dir, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(from, a);
    const u = dot(s, p) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(dir, q) / det;
    if (v < 0 || u + v > 1) continue;
    const d = dot(e2, q) / det;
    if (d > 0 && d < best) {
      best = d;
      normal = norm(cross(e1, e2));
    }
  }
  if (best === Infinity) throw new Error(`crewman: a fitting missed its surface from ${from} along ${dir} (${tris.length / 9} triangles)`);
  return { at: add(from, mul(dir, best)), normal };
}

/** The triangles a mesher added from `start` (a count of position numbers), for `hit`. */
function since(m: Mesher, start: number): number[] {
  return m.positions.slice(start);
}

// --- skinning shares along the body ---

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The torso's bones up its height (y as made). */
function torsoSkin(y: number): Skin {
  if (y < 0.04) return [B.pelvis, B.spine_01, 0];
  if (y < 0.16) return [B.pelvis, B.spine_01, smooth(0.04, 0.16, y)];
  if (y < 0.3) return [B.spine_01, B.spine_02, smooth(0.16, 0.3, y)];
  if (y < 0.44) return [B.spine_02, B.spine_03, smooth(0.3, 0.44, y)];
  return [B.spine_03, B.neck_01, 0];
}

// --- the shapes ---

/** Hips to shoulders: the seat of the trousers, the jerkin over the blouse. */
const TORSO: ReadonlyArray<readonly [y: number, z: number, rx: number, rz: number]> = [
  [-0.075, -0.035, 0.13, 0.095],
  [-0.045, -0.035, 0.165, 0.12],
  [0.0, -0.03, 0.168, 0.12],
  [0.06, -0.025, 0.158, 0.112],
  [0.12, -0.022, 0.148, 0.105],
  [0.2, -0.022, 0.152, 0.106],
  [0.28, -0.026, 0.165, 0.113],
  [0.36, -0.03, 0.178, 0.118],
  [0.43, -0.038, 0.186, 0.112],
  [0.49, -0.046, 0.18, 0.098],
  [0.535, -0.05, 0.13, 0.08],
  [0.56, -0.05, 0.07, 0.064],
];
/** The jerkin's hem and its neckline at the front, y as made. */
const JERKIN_HEM = 0.0;
const JERKIN_NECK = 0.47;
/** The belt's lower and upper edges, y as made, at the front (it dips 1 cm to the back). */
const BELT: readonly [number, number] = [0.095, 0.14];
/** The anklets' lower and upper edges, y as made. */
const ANKLET: readonly [number, number] = [-0.44, -0.33];

/** The head: rings up from under the chin to the crown, y from the eyes, centre z, half-width, half-depth. */
const HEAD: ReadonlyArray<readonly [y: number, z: number, rx: number, rz: number, n: number]> = [
  [-0.108, -0.035, 0.036, 0.058, 2.2],
  [-0.098, -0.032, 0.044, 0.075, 2.3],
  [-0.07, -0.045, 0.064, 0.09, 2.4],
  [-0.038, -0.052, 0.075, 0.098, 2.6],
  [-0.012, -0.056, 0.078, 0.101, 2.5],
  [0.018, -0.058, 0.079, 0.102, 2.4],
  [0.05, -0.062, 0.078, 0.1, 2.3],
  [0.085, -0.07, 0.07, 0.09, 2.2],
  [0.11, -0.076, 0.05, 0.066, 2.1],
];
const HEAD_SIDES = 14;
/** The beret's band: its lower edge's height over the eyes at the front, sides and back, m, and its depth. */
const BAND_FRONT = 0.046;
const BAND_SIDE = 0.032;
const BAND_BACK = 0.012;
const BAND_DEPTH = 0.016;
/** How far the band and crown stand off the head, m. */
const BAND_OFF = 0.007;

/** The arm as made (left), shoulder to wrist: centre, half-width, half-depth, bones. */
function armRings(side: 1 | -1): Ring[] {
  const sh = BONES[B.upperarm_l][2];
  const el = BONES[B.lowerarm_l][2];
  const wr = BONES[B.hand_l][2];
  const upper = side > 0 ? B.upperarm_l : B.upperarm_r;
  const lower = side > 0 ? B.lowerarm_l : B.lowerarm_r;
  const at = (p: V3): V3 => (side > 0 ? p : mirrorX(p));
  return [
    { c: at(lerp3(sh, el, 0.0)), rx: 0.052, rz: 0.056, skin: [upper, upper, 0] },
    { c: at(lerp3(sh, el, 0.3)), rx: 0.05, rz: 0.052, skin: [upper, upper, 0] },
    { c: at(lerp3(sh, el, 0.7)), rx: 0.044, rz: 0.045, skin: [upper, upper, 0] },
    { c: at(lerp3(sh, el, 0.93)), rx: 0.043, rz: 0.043, skin: [upper, lower, 0.25] },
    { c: at(add(el, [0, -0.012, 0.012])), rx: 0.044, rz: 0.044, skin: [upper, lower, 0.5] },
    { c: at(lerp3(el, wr, 0.1)), rx: 0.044, rz: 0.042, skin: [upper, lower, 0.8] },
    { c: at(lerp3(el, wr, 0.4)), rx: 0.042, rz: 0.038, skin: [lower, lower, 0] },
    { c: at(lerp3(el, wr, 0.82)), rx: 0.034, rz: 0.03, skin: [lower, lower, 0] },
    { c: at(lerp3(el, wr, 1.0)), rx: 0.033, rz: 0.029, skin: [lower, lower, 0] },
  ];
}

/** The leg as made (left), hip to ankle, sitting: centre, half-width, half-thickness, bones. */
function legRings(side: 1 | -1): Ring[] {
  const thigh = side > 0 ? B.thigh_l : B.thigh_r;
  const calf = side > 0 ? B.calf_l : B.calf_r;
  const x = 0.095 * side;
  return [
    { c: [x, 0.0, -0.05], rx: 0.088, rz: 0.08, skin: [B.pelvis, thigh, 0.6] },
    { c: [x, -0.002, 0.08], rx: 0.086, rz: 0.077, skin: [thigh, thigh, 0] },
    { c: [x, -0.004, 0.22], rx: 0.078, rz: 0.069, skin: [thigh, thigh, 0] },
    { c: [x * 1.04, -0.006, 0.36], rx: 0.064, rz: 0.06, skin: [thigh, thigh, 0] },
    { c: [x * 1.05, -0.03, 0.445], rx: 0.058, rz: 0.06, skin: [thigh, calf, 0.5] },
    { c: [x * 1.05, -0.1, 0.46], rx: 0.056, rz: 0.057, skin: [thigh, calf, 0.9] },
    { c: [x * 1.05, -0.22, 0.448], rx: 0.054, rz: 0.058, skin: [calf, calf, 0] },
    { c: [x * 1.05, -0.33, 0.43], rx: 0.045, rz: 0.048, skin: [calf, calf, 0] },
    { c: [x * 1.05, -0.375, 0.423], rx: 0.042, rz: 0.044, skin: [calf, calf, 0] },
  ];
}

/** The boot as made (left): rings heel to toe, centre, half-width, half-height. */
function bootRings(side: 1 | -1): Ring[] {
  const foot = side > 0 ? B.foot_l : B.foot_r;
  const ball = side > 0 ? B.ball_l : B.ball_r;
  const x = 0.1 * side;
  const sole = CREWMAN_FLOOR;
  return [
    { c: [x, sole + 0.04, 0.345], rx: 0.036, rz: 0.035, skin: [foot, foot, 0], n: 3 },
    { c: [x, sole + 0.055, 0.37], rx: 0.044, rz: 0.055, skin: [foot, foot, 0], n: 3 },
    { c: [x, sole + 0.055, 0.42], rx: 0.047, rz: 0.055, skin: [foot, foot, 0], n: 3 },
    { c: [x, sole + 0.04, 0.48], rx: 0.049, rz: 0.04, skin: [foot, ball, 0.3], n: 3 },
    { c: [x, sole + 0.03, 0.535], rx: 0.048, rz: 0.03, skin: [foot, ball, 0.8], n: 3 },
    { c: [x, sole + 0.026, 0.575], rx: 0.04, rz: 0.026, skin: [ball, ball, 0], n: 3 },
  ];
}

/**
 * The crewman's body as made, skinned to `createCrewmanBones()`, its
 * neckerchief in crew colour `crew` (hex).
 */
export function crewmanGeometry(crew: number): BufferGeometry {
  return build(crew).body.geometry(true);
}

/** The beret, badge and headset as made (in the body's space, facing +Z), to draw rigidly with the head. */
export function crewmanHeadgearGeometry(): BufferGeometry {
  return build(0).headgear.geometry(false);
}

/** A fresh skeleton as made: the bones in skin-index order, the first (the pelvis) the root. */
export function createCrewmanBones(): Bone[] {
  const bones = BONES.map(([name]) => {
    const bone = new Bone();
    bone.name = name;
    return bone;
  });
  BONES.forEach(([, parent, at], i) => {
    const p = parent < 0 ? [0, 0, 0] : BONES[parent][2];
    bones[i].position.set(at[0] - p[0], at[1] - p[1], at[2] - p[2]);
    if (parent >= 0) bones[parent].add(bones[i]);
  });
  return bones;
}

function build(crew: number): { body: Mesher; headgear: Mesher } {
  const m = new Mesher();
  const eyeY = CREWMAN_EYES[1];

  // The torso: trousers below the jerkin's hem, the jerkin over the blouse, the blouse showing at the neck.
  const torsoStart = m.positions.length;
  const torso = loft(
    m,
    TORSO.map(([y, z, rx, rz]) => ({ c: [0, y, z] as V3, rx, rz, skin: torsoSkin(y), n: 2.4 })),
    {
      sides: 14,
      side: [1, 0, 0],
      color: (_seg, _k, theta, at) => {
        const front = Math.sin(theta);
        if (at[1] < JERKIN_HEM) return C.serge;
        // A square neckline at the front; the blouse's khaki above it.
        if (at[1] > 0.55) return C.serge;
        return C.jerkin;
      },
      capStart: { out: 0.0, color: C.serge },
    },
  );
  const torsoTris = since(m, torsoStart);
  const torsoAxis = (p: V3): V3 => {
    // The torso's centre line at a point's height.
    for (let i = 0; i < TORSO.length - 1; i++) {
      if (p[1] <= TORSO[i + 1][0] || i === TORSO.length - 2) {
        const t = Math.min(1, Math.max(0, (p[1] - TORSO[i][0]) / (TORSO[i + 1][0] - TORSO[i][0])));
        return [0, p[1], TORSO[i][1] + (TORSO[i + 1][1] - TORSO[i][1]) * t];
      }
    }
    return [0, p[1], 0];
  };
  const thetaOf = (k: number) => (2 * Math.PI * k) / 14;

  // The jerkin's hem, standing proud all round.
  {
    const lower = hugRing(torso, () => JERKIN_HEM, 0.004, torsoAxis);
    const upper = hugRing(torso, () => JERKIN_HEM + 0.03, 0.004, torsoAxis);
    const under = hugRing(torso, () => JERKIN_HEM - 0.004, -0.004, torsoAxis);
    const over = hugRing(torso, () => JERKIN_HEM + 0.03, -0.003, torsoAxis);
    band(m, lower, upper, C.jerkinEdge, (p) => torsoSkin(p[1]));
    band(m, under, lower, C.jerkinEdge, (p) => torsoSkin(p[1]));
    band(m, upper, over, C.jerkinEdge, (p) => torsoSkin(p[1]));
  }

  // The webbing belt, over the jerkin, with a brass buckle at the front.
  {
    const dip = (k: number) => -0.01 * Math.max(0, -Math.sin(thetaOf(k)));
    const at = (y: number) => (k: number) => y + dip(k);
    const lowIn = hugRing(torso, at(BELT[0]), -0.003, torsoAxis);
    const low = hugRing(torso, at(BELT[0]), 0.008, torsoAxis);
    const high = hugRing(torso, at(BELT[1]), 0.008, torsoAxis);
    const highIn = hugRing(torso, at(BELT[1]), -0.003, torsoAxis);
    band(m, lowIn, low, C.webbingDark, (p) => torsoSkin(p[1]));
    band(m, low, high, C.webbing, (p) => torsoSkin(p[1]));
    band(m, high, highIn, C.webbingDark, (p) => torsoSkin(p[1]));
    const front = hit(torsoTris, [0, (BELT[0] + BELT[1]) / 2, 0], [0, 0, 1]);
    plate(m, front.at, front.normal, [0, 1, 0], rect(0.03, 0.026), 0.014, 0.0, C.brass, torsoSkin(0.12));
    plate(m, add(front.at, mul(front.normal, 0.014)), front.normal, [0, 1, 0], rect(0.018, 0.014), 0.004, 0.002, C.webbing, torsoSkin(0.12));
  }

  // The jerkin's four buttons down the front.
  for (const y of [0.2, 0.28, 0.36, 0.44]) {
    const h = hit(torsoTris, [0, y, 0], [0, 0, 1]);
    plate(m, h.at, h.normal, [0, 1, 0], ngon(6, 0.0085), 0.005, 0.003, C.button, torsoSkin(y));
  }

  // The '37 pattern holster on the right hip, its flap and stud, and the ammunition pouch at the left front.
  {
    // Clear of the hip and the right thigh by 7 mm.
    const x = -0.212;
    const holster = torsoSkin(0.02);
    box(m, [x, 0.035, -0.015], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.022, 0.085, 0.052], C.webbing, holster);
    box(m, [x - 0.005, 0.1, -0.015], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.022, 0.032, 0.056], C.webbingDark, holster);
    // Its belt loop, from the belt out to it.
    box(m, [x + 0.036, 0.117, -0.015], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.024, 0.027, 0.016], C.webbingDark, holster);
    box(m, [x - 0.031, 0.083, -0.015], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.005, 0.006, 0.006], C.brass, holster);
    const front = hit(torsoTris, [0.09, 0.1, 0], [0, 0, 1]);
    const pouch = add(front.at, mul(front.normal, 0.022));
    box(m, pouch, [cross([0, 1, 0], front.normal), [0, 1, 0], front.normal], [0.032, 0.03, 0.02], C.webbing, torsoSkin(0.1));
    box(m, add(add(pouch, [0, 0.022, 0]), mul(front.normal, 0.006)), [cross([0, 1, 0], front.normal), [0, 1, 0], front.normal], [0.036, 0.012, 0.022], C.webbingDark, torsoSkin(0.1));
  }

  // The arms: khaki serge sleeves, a ball at each shoulder, closed at the wrist inside the gauntlet.
  for (const side of [1, -1] as const) {
    const upper = side > 0 ? B.upperarm_l : B.upperarm_r;
    const rings = armRings(side);
    loft(m, rings, {
      sides: 8,
      side: [0, 0, 1],
      phase: Math.PI / 8,
      color: C.serge,
      capEnd: { out: 0.01, color: C.serge },
    });
    ball(m, add(rings[0].c, [0, -0.006, 0]), 0.057, C.serge, [upper, upper, 0], 0.72);
  }

  // The legs: trousers, sitting, into webbing anklets over the boots.
  for (const side of [1, -1] as const) {
    const leg = loft(m, legRings(side), {
      sides: 9,
      side: [1, 0, 0],
      color: C.serge,
      capEnd: { out: 0.0, color: C.serge },
    });
    const calf = side > 0 ? B.calf_l : B.calf_r;
    // The anklet: a webbing band round the trousers' foot and the boot's top, 8 mm off them, with its lips turned in.
    const foot = side > 0 ? B.foot_l : B.foot_r;
    const ankleSkin: Skin = [calf, calf, 0];
    const anklet = (y: number, r: number, depth: number) => ring([0.1 * side * 1.05, y, 0.425 - (y + 0.33) * 0.06], r, r + depth, 9);
    const lowIn = anklet(ANKLET[0], 0.044, 0.002);
    const low = anklet(ANKLET[0], 0.051, 0.002);
    const high = anklet(ANKLET[1], 0.055, 0.003);
    const highIn = anklet(ANKLET[1], 0.047, 0.003);
    band(m, lowIn, low, C.webbingDark, ankleSkin);
    band(m, low, high, C.webbing, ankleSkin);
    band(m, high, highIn, C.webbingDark, ankleSkin);
    // Its two strap buckles on the outside.
    for (const y of [-0.355, -0.405]) {
      box(m, [0.159 * side, y, 0.425], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.006, 0.007, 0.01], C.brass, ankleSkin);
    }
    // The boot: its leg up inside the anklet, its foot heel to toe, the sole darker.
    loft(
      m,
      [
        { c: [0.1 * side, CREWMAN_FLOOR + 0.07, 0.405], rx: 0.044, rz: 0.048, skin: [foot, foot, 0] },
        { c: [0.1 * side * 1.05, ANKLET[0] + 0.01, 0.42], rx: 0.043, rz: 0.044, skin: [calf, foot, 0.3] },
        { c: [0.1 * side * 1.05, ANKLET[0] + 0.04, 0.422], rx: 0.036, rz: 0.037, skin: [calf, calf, 0] },
      ],
      { sides: 8, side: [1, 0, 0], color: C.boot, capEnd: { out: 0, color: C.boot } },
    );
    loft(m, bootRings(side), {
      sides: 8,
      side: [1, 0, 0],
      phase: Math.PI / 8,
      color: (_s, _k, theta) => (Math.sin(theta) > 0.75 ? C.sole : C.boot),
      capStart: { out: 0.008, color: C.boot },
      capEnd: { out: 0.012, color: C.boot },
    });
  }

  // The neck: skin, the neckerchief round its foot, the blouse's collar standing round that.
  const neckStart = m.positions.length;
  loft(
    m,
    [
      { c: [0, 0.535, -0.05], rx: 0.061, rz: 0.063, skin: [B.spine_03, B.neck_01, 0.3] },
      { c: [0, 0.585, -0.049], rx: 0.059, rz: 0.06, skin: [B.neck_01, B.neck_01, 0] },
      { c: [0, 0.635, -0.047], rx: 0.057, rz: 0.059, skin: [B.neck_01, B.Head, 0.4] },
      { c: [0, 0.69, -0.047], rx: 0.054, rz: 0.057, skin: [B.Head, B.Head, 0] },
    ],
    { sides: 10, side: [1, 0, 0], color: (seg) => (seg === 0 ? crew : C.skin) },
  );
  const neckTris = since(m, neckStart);
  {
    // The collar: a short open band, its fronts turned out.
    const N = 12;
    const rings: Ring[] = [
      { c: [0, 0.535, -0.05], rx: 0.074, rz: 0.076, skin: [B.spine_03, B.spine_03, 0] },
      { c: [0, 0.592, -0.049], rx: 0.069, rz: 0.07, skin: [B.spine_03, B.neck_01, 0.4] },
    ];
    const open = (_s: number, _k: number, theta: number) => Math.sin(theta) > 0.85;
    loft(m, rings, { sides: N, side: [1, 0, 0], color: C.collar, skip: open });
    // Its inside, so it has thickness.
    loft(
      m,
      rings.map((r) => ({ ...r, rx: r.rx - 0.005, rz: r.rz - 0.005 })),
      { sides: N, side: [1, 0, 0], color: C.collar, skip: open, inward: true },
    );
    // The neckerchief's knot at the throat and its ends over the blouse.
    const throat = hit(neckTris, [0, 0.548, -0.05], [0, 0, 1]);
    const knot = add(throat.at, [0, -0.004, 0.005]);
    box(m, knot, [[1, 0, 0], [0, 1, 0.3], [0, -0.3, 1]], [0.019, 0.015, 0.008], crew, [B.spine_03, B.spine_03, 0]);
    const chest = hit(torsoTris, [0, 0.5, -0.04], [0, 0, 1]);
    const tip: V3 = add(chest.at, [0, -0.045, 0.012]);
    const s: Skin = [B.spine_03, B.spine_03, 0];
    const l: V3 = add(knot, [0.016, -0.008, -0.004]);
    const r: V3 = add(knot, [-0.016, -0.008, -0.004]);
    m.tri(l, r, tip, crew, s);
    m.tri(r, l, add(tip, [0, 0, -0.008]), crew, s);
  }

  // The head.
  const headStart = m.positions.length;
  const head = loft(
    m,
    HEAD.map(([y, z, rx, rz, n]) => ({ c: [0, eyeY + y, z] as V3, rx, rz, n, skin: [B.Head, B.Head, 0] as Skin })),
    {
      sides: HEAD_SIDES,
      side: [1, 0, 0],
      color: (_seg, _k, theta, at) => {
        const front = Math.sin(theta);
        const y = at[1] - eyeY;
        // Short back and sides under the beret: hair round the back down to the nape.
        if (front < -0.05 && y > -0.045) return C.hair;
        if (front < 0.25 && y > 0.0) return C.hair;
        return C.skin;
      },
      capStart: { out: 0.004, color: C.skin },
      capEnd: { out: 0.006, color: C.hair },
    },
  );
  const headTris = since(m, headStart);
  const headSkin: Skin = [B.Head, B.Head, 0];
  const headAxisAt = (p: V3): V3 => {
    const y = p[1] - eyeY;
    for (let i = 0; i < HEAD.length - 1; i++) {
      if (y <= HEAD[i + 1][0] || i === HEAD.length - 2) {
        const t = Math.min(1, Math.max(0, (y - HEAD[i][0]) / (HEAD[i + 1][0] - HEAD[i][0])));
        return [0, p[1], HEAD[i][1] + (HEAD[i + 1][1] - HEAD[i][1]) * t];
      }
    }
    return [0, p[1], -0.06];
  };

  // The face: eyes, brows, nose, mouth and ears. The eyes, lids and brows face forwards, whatever facet they sit on.
  const facing = (n: V3): V3 => norm(add(n, [0, 0, 2]));
  for (const side of [1, -1] as const) {
    const x = 0.033 * side;
    const eye = hit(headTris, [x, eyeY, -0.05], [0, 0, 1]);
    plate(m, eye.at, facing(eye.normal), [0, 1, 0], almond(0.0135, 0.0064, side), 0.0034, 0.006, C.sclera, headSkin, { radius: 0.0063, color: C.iris });
    // The upper lid: a skin shelf over the eye.
    const lid = hit(headTris, [x, eyeY + 0.0098, -0.05], [0, 0, 1]);
    plate(m, lid.at, facing(lid.normal), [0, 1, 0], lidShape(0.0155, 0.0042, side), 0.0078, 0.006, C.skin, headSkin);
    const brow = hit(headTris, [x * 1.05, eyeY + 0.021, -0.05], [0, 0, 1]);
    plate(m, brow.at, facing(brow.normal), [0.12 * side, 1, 0], browShape(0.018, 0.0042, side), 0.0045, 0.006, C.brow, headSkin);
    // The ears, under the headset's earphones.
    const ear = hit(headTris, [0, eyeY - 0.012, -0.075], [side, 0, 0]);
    plate(m, ear.at, ear.normal, [0, 1, 0.15], earShape(side), 0.012, 0.004, C.skin, headSkin);
  }
  {
    const face = (x: number, y: number) => hit(headTris, [x, eyeY + y, -0.05], [0, 0, 1]).at;
    const bridge = face(0, -0.002);
    const tipAt = add(face(0, -0.033), [0, 0.002, 0.019]);
    const base = add(face(0, -0.043), [0, 0, 0.004]);
    const wingL = face(0.015, -0.04);
    const wingR = face(-0.015, -0.04);
    const topL = face(0.007, 0.002);
    const topR = face(-0.007, 0.002);
    const ridge = add(bridge, [0, 0, 0.006]);
    const sunk = (p: V3): V3 => add(p, [0, 0, -0.004]);
    m.tri(ridge, sunk(topR), tipAt, C.skin, headSkin);
    m.tri(ridge, tipAt, sunk(topL), C.skin, headSkin);
    m.tri(sunk(topL), tipAt, sunk(wingL), C.skin, headSkin);
    m.tri(sunk(topR), sunk(wingR), tipAt, C.skin, headSkin);
    m.tri(tipAt, sunk(wingR), base, C.skin, headSkin);
    m.tri(tipAt, base, sunk(wingL), C.skin, headSkin);
    const mouth = hit(headTris, [0, eyeY - 0.062, -0.05], [0, 0, 1]);
    plate(m, mouth.at, facing(mouth.normal), [0, 1, 0], mouthShape(), 0.0032, 0.004, C.lips, headSkin);
  }

  // --- headgear, drawn rigidly with the head ---
  const g = new Mesher();
  const none: Skin = [0, 0, 0];
  const bandAt = (y: number) => (k: number) => {
    const theta = (2 * Math.PI * k) / HEAD_SIDES;
    const front = Math.sin(theta);
    const h = front > 0 ? BAND_SIDE + (BAND_FRONT - BAND_SIDE) * front : BAND_SIDE + (BAND_SIDE - BAND_BACK) * front;
    return eyeY + h + y;
  };
  // The band: black leather binding, tight round the head.
  const bandLowIn = hugRing(head, bandAt(0), BAND_OFF - 0.005, headAxisAt);
  const bandLow = hugRing(head, bandAt(0), BAND_OFF, headAxisAt);
  const bandHigh = hugRing(head, bandAt(BAND_DEPTH), BAND_OFF, headAxisAt);
  band(g, bandLowIn, bandLow, C.binding, none);
  band(g, bandLow, bandHigh, C.binding, none);
  // The crown: the beret's body puffed out over the band, pulled down over the right ear.
  // The crown: a soft disc lying on the head, tilted down to the right, its rolled edge just clear of the head on
  // the left, front and back and hanging out and down over the right ear; its top a little domed.
  const disc = { x: -0.035, y: eyeY + 0.098, z: -0.07, rx: 0.118, rz: 0.108, slope: 0.2 };
  const discY = (x: number) => disc.y + disc.slope * (x - disc.x);
  const crown = (scale: number, lift: number) =>
    bandHigh.map((_, k) => {
      const theta = (2 * Math.PI * k) / HEAD_SIDES;
      const x = disc.x + Math.cos(theta) * disc.rx * scale;
      const right = Math.max(0, -Math.cos(theta));
      const p: V3 = [x, discY(x) + lift - 0.032 * right * right * scale * scale, disc.z + Math.sin(theta) * disc.rz * scale];
      // Never closer to the head than 15 mm, out from its middle (its facets cut corners between the points).
      const axis = headAxisAt(p);
      const out = norm(sub(p, axis));
      let skin = 0;
      try {
        skin = len(sub(hit(headTris, axis, out).at, axis));
      } catch {
        skin = 0;
      }
      const reach = len(sub(p, axis));
      return reach < skin + 0.015 ? add(axis, mul(out, skin + 0.015)) : p;
    });
  const rings = [bandHigh, crown(0.93, -0.014), crown(1, -0.004), crown(0.96, 0.012), crown(0.8, 0.03), crown(0.5, 0.044)];
  for (let i = 0; i < rings.length - 1; i++) band(g, rings[i], rings[i + 1], C.beret, none);
  const peak: V3 = [disc.x, discY(disc.x) + 0.05, disc.z];
  const upper = rings[rings.length - 1];
  for (let k = 0; k < HEAD_SIDES; k++) g.tri(peak, upper[k], upper[(k + 1) % HEAD_SIDES], C.beret, none);
  // The badge over the left eye, on the band.
  {
    const beretTris = since(g, 0);
    const from: V3 = [0.034, eyeY + BAND_FRONT + BAND_DEPTH * 0.5, -0.06];
    const b = hit(beretTris, from, [0, 0, 1]);
    plate(g, b.at, b.normal, [0, 1, 0], badgeShape(), 0.004, 0.002, C.badge, none);
  }
  // The headset: a band over the crown, the earphones on the ears.
  {
    const gearTris = () => since(g, 0).concat(headTris);
    const cupY = eyeY - 0.012;
    const cupZ = -0.075;
    const cups: V3[] = [];
    for (const side of [1, -1] as const) {
      const ear = hit(headTris.concat(since(m, 0)), [0, cupY, cupZ], [side, 0, 0]);
      const x = ear.at[0] + side * 0.016;
      cups.push([x, cupY, cupZ]);
      cylinderX(g, [x, cupY, cupZ], 0.031, 0.012, 0.014, 10, C.headset, none);
      cylinderX(g, [x + side * 0.018, cupY, cupZ], 0.013, 0.006, 0.004, 8, C.headsetBand, none);
    }
    // The arch: half an ellipse from one earphone's top to the other's, as low as clears the beret by 8 mm.
    const baseY = cupY + 0.03;
    const centreArc: V3 = [(cups[0][0] + cups[1][0]) / 2, baseY, cupZ];
    const halfX = (cups[0][0] - cups[1][0]) / 2;
    const steps = 12;
    const tris = gearTris();
    const clearAt = (a: number, halfY: number) => {
      const p: V3 = add(centreArc, [Math.cos(a) * halfX, Math.sin(a) * halfY, 0]);
      const dir = norm(sub(p, centreArc));
      let d = 0;
      try {
        d = len(sub(hit(tris, add(centreArc, mul(dir, 0.01)), dir).at, centreArc));
      } catch {
        d = 0;
      }
      return len(sub(p, centreArc)) >= d + 0.008;
    };
    let halfY = 0.05;
    while (halfY < 0.3) {
      let clear = true;
      for (let i = 1; i < steps && clear; i++) clear = clearAt((Math.PI * i) / steps, halfY);
      if (clear) break;
      halfY += 0.002;
    }
    if (halfY >= 0.3) throw new Error('crewman: the headset band cannot clear the beret');
    const arc: V3[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = (Math.PI * i) / steps;
      arc.push(add(centreArc, [Math.cos(a) * halfX, Math.sin(a) * halfY, 0]));
    }
    for (let i = 0; i < steps; i++) {
      const a = arc[i];
      const b = arc[i + 1];
      const along = sub(b, a);
      const mid = mul(add(a, b), 0.5);
      const outward = norm(sub(mid, centreArc));
      box(g, add(mid, mul(outward, 0.002)), [along, outward, [0, 0, 1]], [len(along) / 2 + 0.002, 0.0025, 0.011], C.headsetBand, none);
    }
  }
  return { body: m, headgear: g };
}

/** A low-poly ball (a shoulder's top), cut off below `keep` of its height. */
function ball(m: Mesher, centre: V3, radius: number, color: number, skin: Skin, keep: number): void {
  const rings = 4;
  const sides = 8;
  const pts: V3[][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings;
    const y = Math.cos(phi);
    const r = Math.sin(phi);
    const row: V3[] = [];
    for (let k = 0; k < sides; k++) {
      const th = (2 * Math.PI * (k + 0.5)) / sides;
      row.push(add(centre, [Math.cos(th) * r * radius, y * radius * keep, Math.sin(th) * r * radius]));
    }
    pts.push(row);
  }
  for (let i = 0; i < rings; i++) {
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      if (i === 0) m.tri(pts[0][k], pts[1][k1], pts[1][k], color, skin);
      else if (i === rings - 1) m.tri(pts[i][k], pts[i][k1], pts[i + 1][k], color, skin);
      else m.quad(pts[i][k], pts[i][k1], pts[i + 1][k1], pts[i + 1][k], color, skin);
    }
  }
}

/** A short drum along X: an earphone. */
function cylinderX(m: Mesher, centre: V3, radius: number, inner: number, outer: number, sides: number, color: number, skin: Skin): void {
  const side = Math.sign(centre[0]) || 1;
  const xIn = centre[0] - side * inner;
  const xOut = centre[0] + side * outer;
  const ring = (x: number): V3[] => Array.from({ length: sides }, (_, k) => {
    const a = (2 * Math.PI * (k + 0.5)) / sides;
    return [x, centre[1] + Math.cos(a) * radius, centre[2] + Math.sin(a) * radius] as V3;
  });
  const a = ring(xIn);
  const b = ring(xOut);
  const cIn: V3 = [xIn, centre[1], centre[2]];
  const cOut: V3 = [xOut, centre[1], centre[2]];
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    if (side > 0) {
      m.quad(a[k], a[k1], b[k1], b[k], color, skin);
      m.tri(cOut, b[k], b[k1], color, skin);
      m.tri(cIn, a[k1], a[k], color, skin);
    } else {
      m.quad(a[k], b[k], b[k1], a[k1], color, skin);
      m.tri(cOut, b[k1], b[k], color, skin);
      m.tri(cIn, a[k], a[k1], color, skin);
    }
  }
}

// --- outlines for plates, m ---

function rect(w: number, h: number): Array<[number, number]> {
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
}

function ngon(n: number, r: number): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  });
}

/** An eye's outline, its outer corner a little higher (anticlockwise, x towards the model's left). */
function almond(w: number, h: number, side: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [
    [-w, 0.001],
    [-w * 0.55, -h * 0.85],
    [0, -h],
    [w * 0.55, -h * 0.8],
    [w, 0.0015],
    [w * 0.5, h * 0.95],
    [0, h],
    [-w * 0.55, h * 0.8],
  ];
  return side > 0 ? pts : pts.map(([x, y]) => [-x, y] as [number, number]).reverse();
}

function lidShape(w: number, h: number, side: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [
    [-w, -h * 0.2],
    [0, -h],
    [w, -h * 0.1],
    [w * 0.6, h],
    [-w * 0.6, h],
  ];
  return side > 0 ? pts : pts.map(([x, y]) => [-x, y] as [number, number]).reverse();
}

function browShape(w: number, h: number, side: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [
    [-w, -h * 0.4],
    [w * 0.2, -h],
    [w, -h * 0.3],
    [w * 0.9, h * 0.6],
    [0, h],
    [-w * 0.95, h * 0.5],
  ];
  return side > 0 ? pts : pts.map(([x, y]) => [-x, y] as [number, number]).reverse();
}

function earShape(side: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [
    [-0.012, -0.026],
    [0.008, -0.022],
    [0.016, 0.0],
    [0.012, 0.024],
    [-0.006, 0.03],
    [-0.016, 0.01],
  ];
  return side > 0 ? pts : pts.map(([x, y]) => [-x, y] as [number, number]).reverse();
}

function mouthShape(): Array<[number, number]> {
  return [
    [-0.018, 0.0005],
    [-0.009, -0.0035],
    [0, -0.0042],
    [0.009, -0.0035],
    [0.018, 0.0005],
    [0.009, 0.0026],
    [0, 0.002],
    [-0.009, 0.0026],
  ];
}

function badgeShape(): Array<[number, number]> {
  return [
    [0, -0.014],
    [0.009, -0.011],
    [0.012, 0.0],
    [0.009, 0.01],
    [0, 0.015],
    [-0.009, 0.01],
    [-0.012, 0.0],
    [-0.009, -0.011],
  ];
}
