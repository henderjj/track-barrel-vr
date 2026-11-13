import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Mesh, MeshStandardMaterial, PlaneGeometry } from '@iwsdk/core';
import {
  BOX_Z,
  boxSpot,
  BRIDGE,
  BRIDGE_SPAN,
  BYPASS,
  BYPASS_PATH,
  COURSE,
  COURSE_BOARD,
  COURSE_PATH,
  COURSE_TARGETS,
  courseBoardMiddle,
  FIRING_BOX,
  type Gate,
  GATES,
  MUD,
  MUD_SPAN,
  PENALTY,
  PENALTY_GATE,
  PENALTY_OWN,
  PENALTY_PATH,
  type Path,
  type PathPoint,
  samplePath,
  SLALOM,
  WATER_Y,
  DITCH_WATER_Y,
} from '../sim/course.js';
import { CELL, DITCH, groundHeight, STREAM } from '../sim/terrain.js';
import { beam, mergeParts, type Part } from './lowpoly.js';

/**
 * The biathlon course's parts (F5.3a, docs/biathlon-course.md): the loop's
 * gravel track and the penalty loop's, the gates' flagged posts and the
 * start and finish gantry, the two firing boxes painted on the track with
 * their corner posts, and each firing line's three boards (drawn on
 * their own since they move with each race). The ground's model (terrain.scene-asset.ts) merges them into its
 * chunks, a copy per tile, as it does the range's, so they move with the
 * world as the tank drives.
 *
 * Built in the ground's own space, like range.scene-asset.ts: x and z as
 * src/sim/course.ts gives them, y from the ground's surface at the start.
 *
 * The driving challenge (F5.3d, docs/biathlon-driving.md) adds the mud on
 * the south side with the gravel bypass round it, the treadway bridge over
 * the ditch on the west side, the water in the ditch and the ford, and the
 * slalom's posts (drawn on their own, createSlalomPost, since they get
 * knocked down). The hill, the ditch and the stream are the ground's own
 * shape (src/sim/terrain.ts's courseRelief), so the tracks follow it.
 */

const GRAVEL = 0xb4a684;
const GRAVEL_PENALTY = 0xa08c6a;
const PAINT = 0xf2f0e8;
const POLE = 0xece8de;
const FLAG = 0xc8302a;
const FLAG_PENALTY = 0xe8b520;
const BLACK = 0x1e1e1e;
const BOX_BLUE = 0x2456a8;
const BOARD = 0xf4f2ea;
const WOOD_DARK = 0x6e4a2b;
const MUD_BROWN = 0x5c4630;
const GRAVEL_BYPASS = 0xbcae8c;
const STEEL = 0x6b6f66;
const STEEL_DARK = 0x45483f;
const TIMBER = 0x7a5a3a;
const WATER = 0x3f6e84;
const DITCH_WATER = 0x35596a;
const MARKER = 0xe8762a;

/** The tracks are drawn in pieces about this long, m, each filed in the chunk of ground its middle stands in. */
const PIECE = 50;
/** The tracks' middle lines are sampled this often, m: a corner of 30 m radius in 5 m steps looks round. */
const STEP = 5;

/** A flat strip `half` m either side of `path`'s middle line from `from` to `to` m along it, `lift` m above the ground, facing up. */
function ribbon(path: Path, from: number, to: number, half: number, lift: number): BufferGeometry {
  const points = withFolds(path, samplePath(path, from, to, STEP));
  const positions: number[] = [];
  const edge = (p: { x: number; z: number; heading: number }, side: number): number[] => {
    const x = p.x + side * half * -Math.cos(p.heading);
    const z = p.z + side * half * Math.sin(p.heading);
    return [x, groundHeight(x, z) + lift, z];
  };
  for (let i = 1; i < points.length; i++) {
    const aL = edge(points[i - 1], 1);
    const aR = edge(points[i - 1], -1);
    const bL = edge(points[i], 1);
    const bR = edge(points[i], -1);
    // Wound to face up (+Y): left edge, right edge, then on along the path.
    positions.push(...aL, ...aR, ...bR, ...aL, ...bR, ...bL);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

/**
 * The samples with a point added wherever the middle line crosses a grid
 * line of the height field (x or z a whole number of CELLs), where the
 * ground can fold: over the hill's crest and down into the ford a strip
 * laid straight between samples either side of a fold would sink into the
 * ground or stand off it. Between grid lines the ground is flat (one
 * triangle, or two that the course's relief keeps in one plane, since it
 * changes only along the track where it crosses the hill and the stream),
 * so the strip lies on it at its lift.
 */
function withFolds(path: Path, points: PathPoint[]): PathPoint[] {
  const out: PathPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const cuts: number[] = [];
    for (const [u, v] of [[a.x, b.x], [a.z, b.z]] as const) {
      const lo = Math.min(u, v);
      const hi = Math.max(u, v);
      for (let g = Math.floor(lo / CELL) + 1; g * CELL < hi; g++) {
        const t = (g * CELL - u) / (v - u);
        if (t > 1e-4 && t < 1 - 1e-4) cuts.push(t);
      }
    }
    cuts.sort((p, q) => p - q);
    for (const t of cuts) out.push(path.at(a.s + (b.s - a.s) * t));
    out.push(b);
  }
  return out;
}

/** A track cut into pieces of about PIECE m, each with the (x, z) to file it under. */
function trackPieces(path: Path, from: number, to: number, half: number, lift: number, color: number, dx: number, dz: number): { part: Part; x: number; z: number }[] {
  const out: { part: Part; x: number; z: number }[] = [];
  const pieces = Math.max(1, Math.round((to - from) / PIECE));
  for (let k = 0; k < pieces; k++) {
    const a = from + ((to - from) * k) / pieces;
    const b = from + ((to - from) * (k + 1)) / pieces;
    const geometry = ribbon(path, a, b, half, lift);
    geometry.translate(dx, 0, dz);
    const mid = path.at((a + b) / 2);
    out.push({ part: { geometry, color }, x: mid.x + dx, z: mid.z + dz });
  }
  return out;
}

/**
 * The tracks: the loop's gravel all the way round, and the penalty loop's
 * own part (its last straight is the loop's), a centimetre lower so the
 * two never share a plane where they meet. Each copy offset by (dx, dz).
 */
export function trackParts(dx = 0, dz = 0): { part: Part; x: number; z: number }[] {
  // The course's gravel stops for the bridge (its treads are the track there) and the mud.
  const [bridgeFrom, bridgeTo] = BRIDGE_SPAN;
  const [mudFrom, mudTo] = MUD_SPAN;
  return [
    ...trackPieces(COURSE_PATH, 0, bridgeFrom, COURSE.halfWidth, COURSE.lift, GRAVEL, dx, dz),
    ...trackPieces(COURSE_PATH, bridgeTo, mudFrom, COURSE.halfWidth, COURSE.lift, GRAVEL, dx, dz),
    ...trackPieces(COURSE_PATH, mudTo, COURSE_PATH.length, COURSE.halfWidth, COURSE.lift, GRAVEL, dx, dz),
    // The mud: wider than the gravel, at its height, butting onto it at each end.
    ...trackPieces(COURSE_PATH, mudFrom, mudTo, MUD.half, COURSE.lift, MUD_BROWN, dx, dz),
    // The bypass: a centimetre under the course's gravel where they meet, a paler gravel.
    ...trackPieces(BYPASS_PATH, 0, BYPASS_PATH.length, BYPASS.halfWidth, BYPASS.lift, GRAVEL_BYPASS, dx, dz),
    ...trackPieces(PENALTY_PATH, 0, PENALTY_OWN, PENALTY.halfWidth, PENALTY.lift, GRAVEL_PENALTY, dx, dz),
  ];
}

/** How high paint stands on the track, m: 1.5 cm proud of it (the 8 mm rule), a centimetre thick. */
const PAINT_TOP = COURSE.lift + 0.015;
const PAINT_THICK = 0.01;

/** A gate's post, its flag flying outwards from the track, as parts in the gate's own frame (forward -Z, `side` -1 left or 1 right). */
function gatePost(half: number, side: number, flag: number, height = 3.2): Part[] {
  const x = side * half;
  return [
    { geometry: new CylinderGeometry(0.07, 0.07, height, 6, 1), color: POLE, position: [x, height / 2 - 0.1, 0] },
    // The flag's inner edge ends inside the post.
    { geometry: new BoxGeometry(0.9, 0.55, 0.03), color: flag, position: [x + side * 0.48, height - 0.45, 0] },
  ];
}

/** The start and finish: banded posts either side and a chequered banner across, high over the tank, with a chequered line painted on the track. */
function finishParts(half: number): Part[] {
  const height = 5.2;
  const parts: Part[] = [];
  for (const side of [-1, 1]) {
    const x = side * half;
    parts.push({ geometry: new CylinderGeometry(0.1, 0.1, height, 8, 1), color: POLE, position: [x, height / 2 - 0.1, 0] });
    // Black bands, a centimetre proud of the post all round.
    for (let b = 0; b < 4; b++) {
      parts.push({ geometry: new CylinderGeometry(0.11, 0.11, 0.3, 8, 1), color: BLACK, position: [x, 0.6 + b * 0.8, 0] });
    }
  }
  // The banner: a white bar between the posts' tops, with black squares standing proud of it either side in two rows.
  const span = 2 * half;
  const bar = { y: height - 0.7, h: 1.0, thick: 0.08 };
  parts.push({ geometry: new BoxGeometry(span, bar.h, bar.thick), color: PAINT, position: [0, bar.y, 0] });
  const cell = 0.5;
  const columns = Math.floor(span / cell);
  for (let c = 0; c < columns; c++) {
    for (let r = 0; r < 2; r++) {
      if ((c + r) % 2 !== 0) continue;
      const x = -span / 2 + (c + 0.5) * (span / columns);
      const y = bar.y - bar.h / 2 + (r + 0.5) * cell;
      parts.push({ geometry: new BoxGeometry(cell - 0.04, cell - 0.04, bar.thick + 0.04), color: BLACK, position: [x, y, 0] });
    }
  }
  // The line across the track: a white stripe with black squares on it, 1.5 cm proud of the gravel.
  const line = 2 * COURSE.halfWidth;
  parts.push({ geometry: new BoxGeometry(line, PAINT_THICK, 1.0), color: PAINT, position: [0, PAINT_TOP - PAINT_THICK / 2, 0] });
  const squares = Math.round(line / cell);
  for (let c = 0; c < squares; c++) {
    for (let r = 0; r < 2; r++) {
      if ((c + r) % 2 !== 0) continue;
      parts.push({
        geometry: new BoxGeometry(cell - 0.02, PAINT_THICK, cell - 0.02),
        color: BLACK,
        position: [-line / 2 + (c + 0.5) * cell, PAINT_TOP + 0.01 - PAINT_THICK / 2, -0.25 + r * cell],
      });
    }
  }
  return parts;
}

/** Gate `i` (0: the start and finish), or the penalty loop's gate. */
export function gateParts(gate: Readonly<Gate>, penalty = false, dx = 0, dz = 0): Part[] {
  const finish = !penalty && gate === GATES[0];
  const local = finish
    ? finishParts(gate.half)
    : [...gatePost(gate.half, -1, penalty ? FLAG_PENALTY : FLAG), ...gatePost(gate.half, 1, penalty ? FLAG_PENALTY : FLAG)];
  return place(local, gate.x + dx, gate.z + dz, gate.heading);
}

/**
 * Firing box `k`: its outline painted on the track, and a post at each
 * corner just off the track with a blue band per line number, so the
 * driver can see where to stop.
 */
export function boxParts(k: number, dx = 0, dz = 0): Part[] {
  const [x, z, heading] = boxSpot(k);
  const { length, width } = FIRING_BOX;
  const stripe = 0.25;
  const y = PAINT_TOP - PAINT_THICK / 2;
  const local: Part[] = [
    { geometry: new BoxGeometry(width, PAINT_THICK, stripe), color: PAINT, position: [0, y, -length / 2] },
    { geometry: new BoxGeometry(width, PAINT_THICK, stripe), color: PAINT, position: [0, y, length / 2] },
    { geometry: new BoxGeometry(stripe, PAINT_THICK, length), color: PAINT, position: [-width / 2, y, 0] },
    { geometry: new BoxGeometry(stripe, PAINT_THICK, length), color: PAINT, position: [width / 2, y, 0] },
  ];
  const post = { half: 0.07, height: 1.5 };
  for (const across of [-1, 1]) {
    for (const along of [-1, 1]) {
      const px = across * (COURSE.halfWidth + 0.8);
      const pz = (along * length) / 2;
      local.push({ geometry: new BoxGeometry(2 * post.half, post.height, 2 * post.half), color: POLE, position: [px, post.height / 2, pz] });
      for (let b = 0; b <= k; b++) {
        // Each band a centimetre proud of the post all round.
        local.push({ geometry: new BoxGeometry(2 * post.half + 0.02, 0.18, 2 * post.half + 0.02), color: BOX_BLUE, position: [px, post.height - 0.2 - b * 0.3, pz] });
      }
    }
  }
  return place(local, x + dx, z + dz, heading);
}

/**
 * A course board of line `line` standing at the origin on flat ground,
 * facing +Z: a white face on two posts with a black disc standing proud of
 * it, the biathlon target, and a blue bar on top with a white block per
 * line number, so the gunner can tell line 1's from line 2's. Since the
 * harder shooting the boards move with each race's ranges, so they are
 * drawn on their own (range-run.scene-asset.ts's createCourseBoard), not in
 * the ground's chunks.
 */
export function boardLocalParts(line: number): Part[] {
  const { width, height, lift, disc } = COURSE_BOARD;
  const middle = courseBoardMiddle();
  const disk = new CylinderGeometry(disc, disc, 0.06, 20, 1);
  disk.rotateX(Math.PI / 2);
  const local: Part[] = [
    { geometry: new BoxGeometry(width, height, 0.1), color: BOARD, position: [0, middle, 0] },
    // Its front 5 cm proud of the board's, its back inside it.
    { geometry: disk, color: BLACK, position: [0, middle, 0.07] },
  ];
  for (const side of [-1, 1]) {
    local.push(beam([side * width * 0.35, -0.05, -0.1], [side * width * 0.35, lift + height * 0.8, -0.1], 0.06, WOOD_DARK, 6));
  }
  const barY = lift + height + 0.16;
  local.push({ geometry: new BoxGeometry(width, 0.24, 0.12), color: BOX_BLUE, position: [0, barY, 0] });
  for (let b = 0; b <= line; b++) {
    local.push({ geometry: new BoxGeometry(0.2, 0.18, 0.16), color: PAINT, position: [(b - line / 2) * 0.4, barY, 0] });
  }
  return local;
}

/** Course board `j` (COURSE_TARGETS) where it stands now, on the ground: for the tests. */
export function boardParts(j: number, dx = 0, dz = 0): Part[] {
  const t = COURSE_TARGETS[j];
  return place(boardLocalParts(t.line), t.x + dx, t.z + dz, t.yaw);
}

/** Turn parts standing at the origin about +Y and move them to (x, z) on the ground. */
function place(local: Part[], x: number, z: number, yaw: number): Part[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const ground = groundHeight(x, z);
  return local.map((part) => {
    const [px, py, pz] = part.position ?? [0, 0, 0];
    if (yaw !== 0) part.geometry.rotateY(yaw);
    return {
      geometry: part.geometry,
      color: part.color,
      position: [x + px * c + pz * s, ground + py, z - px * s + pz * c] as const,
    };
  });
}

// ---------------------------------------------------------------- The driving challenge (F5.3d)

/** How thick the bridge's treads are, m, and how high their curbs stand above them. */
const TREAD_THICK = 0.12;
const CURB = { width: 0.08, height: 0.1 } as const;

/**
 * The treadway bridge over the ditch (docs/biathlon-driving.md): two steel
 * treads under the tracks' middles with a curb along each edge, a ramp at
 * each end down to the field, steel transoms across under them resting on
 * timber trestles down into the ditch, sills on the banks, and an orange
 * marker post outside each tread at each end. In the ground's space at the
 * bridge's place (its deck's heights are src/sim/course.ts's deckHeight).
 */
export function bridgeParts(dx = 0, dz = 0): Part[] {
  const { x: bx, z: bz, length, ramp, height, tread, gauge } = BRIDGE;
  const half = length / 2;
  const flat = half - ramp;
  const parts: Part[] = [];
  const at = (x: number, y: number, z: number) => [bx + x + dx, y, bz + z + dz] as const;
  const slope = Math.atan2(height, ramp);
  const rampLength = Math.hypot(height, ramp);
  for (const side of [-1, 1]) {
    const x = side * gauge;
    parts.push({ geometry: new BoxGeometry(tread, TREAD_THICK, 2 * flat), color: STEEL, position: at(x, height - TREAD_THICK / 2, 0) });
    for (const edge of [-1, 1]) {
      // A curb along each edge, its outer face in line with the tread's: one colour, so no flicker where they meet.
      parts.push({
        geometry: new BoxGeometry(CURB.width, CURB.height, 2 * flat),
        color: STEEL,
        position: at(x + edge * (tread / 2 - CURB.width / 2), height + CURB.height / 2, 0),
      });
    }
    for (const end of [-1, 1]) {
      // The ramp: a slab tilted from the tread's end down to the field, turned about x.
      const geometry = new BoxGeometry(tread, TREAD_THICK, rampLength);
      geometry.rotateX(end * slope);
      const midZ = end * (flat + ramp / 2);
      // Its top's middle at half the deck's height, its middle a half-thickness below that, square to the slab.
      const y = height / 2 - (TREAD_THICK / 2) * Math.cos(slope);
      const z = midZ - end * (TREAD_THICK / 2) * Math.sin(slope);
      parts.push({ geometry, color: STEEL, position: at(x, y, z) });
      // An orange marker post outside the tread's end, white bands a centimetre proud of it.
      const mx = side * (gauge + tread / 2 + 0.6);
      const mz = end * (half + 0.6);
      parts.push({ geometry: new CylinderGeometry(0.07, 0.07, 1.4, 8, 1), color: MARKER, position: at(mx, groundHeight(bx + mx, bz + mz) + 0.6, mz) });
      for (let b = 0; b < 2; b++) {
        parts.push({ geometry: new CylinderGeometry(0.08, 0.08, 0.18, 8, 1), color: PAINT, position: at(mx, groundHeight(bx + mx, bz + mz) + 0.55 + b * 0.4, mz) });
      }
    }
  }
  // Across both treads: transoms over the trestles and sills on the banks.
  const across = 2 * gauge + tread + 0.4;
  const transomTop = height - TREAD_THICK;
  for (const z of [-DITCH.half / 2, 0, DITCH.half / 2]) {
    parts.push({ geometry: new BoxGeometry(across, 0.2, 0.3), color: STEEL_DARK, position: at(0, transomTop - 0.1, z) });
    for (const side of [-1, 1]) {
      // A trestle leg under each tread, from below the ditch's bottom up to the transom.
      const x = side * gauge;
      const ground = groundHeight(bx + x, bz + z) - 0.3;
      const top = transomTop - 0.2;
      parts.push({ geometry: new BoxGeometry(0.25, top - ground, 0.25), color: TIMBER, position: at(x, (top + ground) / 2, z) });
    }
  }
  for (const end of [-1, 1]) {
    const z = end * (flat - 0.2);
    const ground = groundHeight(bx, bz + z) - 0.15;
    parts.push({ geometry: new BoxGeometry(across, transomTop - ground, 0.4), color: TIMBER, position: at(0, (transomTop + ground) / 2, z) });
  }
  return parts;
}

/** A flat sheet of water facing up, `w` by `d` m, its middle at (x, y, z): the ground hides it wherever it stands above the water. */
function waterSheet(x: number, y: number, z: number, w: number, d: number, color: number): Part {
  const geometry = new PlaneGeometry(w, d);
  geometry.rotateX(-Math.PI / 2);
  return { geometry, color, position: [x, y, z] };
}

/** The water in the ford's stream and in the ditch under the bridge, each copy offset by (dx, dz). */
export function waterParts(dx = 0, dz = 0): { part: Part; x: number; z: number }[] {
  const ford = { x: STREAM.x + dx, z: (STREAM.from + STREAM.to) / 2 + dz };
  const ditch = { x: (DITCH.from + DITCH.to) / 2 + dx, z: DITCH.z + dz };
  return [
    { part: waterSheet(ford.x, WATER_Y, ford.z, 2 * STREAM.half, STREAM.to - STREAM.from + 2 * STREAM.fade, WATER), ...ford },
    { part: waterSheet(ditch.x, DITCH_WATER_Y, ditch.z, DITCH.to - DITCH.from + 2 * DITCH.fade, 2 * DITCH.half, DITCH_WATER), ...ditch },
  ];
}

const SLALOM_RED = 0xd8322a;
/** The radius of a slalom post's rubber foot, m: a knocked post lies on it. */
export const SLALOM_FOOT = 0.22;

/**
 * A slalom post standing at the origin: a white pole SLALOM.post m in
 * radius and SLALOM.height tall with red bands a centimetre proud of it, on
 * a black rubber foot. The course system draws the eight of them on their
 * own (they fall over when the tank knocks them).
 */
export function slalomPostParts(): Part[] {
  const { post, height } = SLALOM;
  const parts: Part[] = [
    { geometry: new CylinderGeometry(0.2, SLALOM_FOOT, 0.06, 10, 1), color: BLACK, position: [0, 0.03, 0] },
    // The pole's foot inside the rubber foot.
    { geometry: new CylinderGeometry(post, post, height, 8, 1), color: POLE, position: [0, height / 2 + 0.02, 0] },
  ];
  for (let b = 0; b < 4; b++) {
    parts.push({ geometry: new CylinderGeometry(post + 0.01, post + 0.01, 0.2, 8, 1), color: SLALOM_RED, position: [0, 0.35 + b * 0.38, 0] });
  }
  return parts;
}

const postMaterial = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });

export function createSlalomPost(): Mesh {
  const mesh = new Mesh(mergeParts(slalomPostParts()), postMaterial);
  mesh.name = 'Slalom Post';
  return mesh;
}

/** Everything on the course but its tracks, each copy offset by (dx, dz), grouped with where to file it. */
export function courseFixtureParts(dx = 0, dz = 0): { parts: Part[]; x: number; z: number }[] {
  const out: { parts: Part[]; x: number; z: number }[] = [];
  for (const gate of GATES) out.push({ parts: gateParts(gate, false, dx, dz), x: gate.x + dx, z: gate.z + dz });
  out.push({ parts: gateParts(PENALTY_GATE, true, dx, dz), x: PENALTY_GATE.x + dx, z: PENALTY_GATE.z + dz });
  BOX_Z.forEach((_, k) => {
    const [x, z] = boxSpot(k);
    out.push({ parts: boxParts(k, dx, dz), x: x + dx, z: z + dz });
  });
  out.push({ parts: bridgeParts(dx, dz), x: BRIDGE.x + dx, z: BRIDGE.z + dz });
  for (const { part, x, z } of waterParts(dx, dz)) out.push({ parts: [part], x, z });
  return out;
}
