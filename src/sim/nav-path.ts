/**
 * The crewmate driver's way across country (F2.13, docs/navigator.md):
 * from where the tank stands to a spot the commander touched on the map,
 * round houses, walls and rocks, the ditch, the stream and the mud, as a
 * few straight legs. A grid over the map's ground, 8 m a square, searched
 * once a touch (A*), then pulled straight wherever a line is clear.
 * Engine-free; the grid is built once, on first use.
 *
 * World space as src/sim/terrain.ts: +X east, −Z north. The ground repeats
 * every TILE, so the grid covers one tile and wraps round at its edges; the
 * way comes back in the tank's own copy, to the goal's copy nearest it.
 */

import { COURSE, waterDepth } from './course.js';
import { MUD } from './mud-bypass.js';
import { groundHeight, obstacleDistance, OBSTACLES, TILE, wrapTile } from './terrain.js';

/** The grid's squares, m. */
export const PATH_CELL = 8;
/** A square is blocked with its middle nearer than this to a house, wall or rock, m: the hull's half width and a margin. */
export const PATH_CLEAR = 6;
/** Ground lower than this is the ditch or the stream's bed, m. */
const LOW_GROUND = -0.4;
/** Kept off the mud by this much beyond it, m. */
const MUD_MARGIN = 4;

/** Squares across one tile; the grid's first square starts at -TILE/2 in x and z. */
const COLS = TILE / PATH_CELL;
const ROWS = COLS;
const ORIGIN = -TILE / 2;

let blockedGrid: Uint8Array | null = null;

function mod(v: number, n: number): number {
  return ((v % n) + n) % n;
}

/** The square a point is in, on the repeating ground. */
function cellOf(x: number, z: number): number {
  const c = Math.min(COLS - 1, Math.floor(mod(x - ORIGIN, TILE) / PATH_CELL));
  const r = Math.min(ROWS - 1, Math.floor(mod(z - ORIGIN, TILE) / PATH_CELL));
  return r * COLS + c;
}

/** A square's middle, on the tile's own copy. */
function cellX(i: number): number {
  return ORIGIN + ((i % COLS) + 0.5) * PATH_CELL;
}

function cellZ(i: number): number {
  return ORIGIN + (Math.floor(i / COLS) + 0.5) * PATH_CELL;
}

/** A square's middle on the copy nearest (nearX, nearZ), into `out`. */
function cellNear(i: number, nearX: number, nearZ: number, out: [number, number]): [number, number] {
  out[0] = nearX + wrapTile(cellX(i) - nearX);
  out[1] = nearZ + wrapTile(cellZ(i) - nearZ);
  return out;
}

/** Whether a point is somewhere the crewmate won't drive: by an obstacle, in the ditch, the water or the mud. */
export function pathBlocked(x: number, z: number): boolean {
  const normal: [number, number] = [0, 0];
  for (const o of OBSTACLES) if (obstacleDistance(o, x, z, normal) < PATH_CLEAR) return true;
  if (groundHeight(x, z) < LOW_GROUND || waterDepth(x, z) > 0) return true;
  if (x > MUD.from - MUD_MARGIN && x < MUD.to + MUD_MARGIN && Math.abs(z - COURSE.south) < MUD.half + MUD_MARGIN) return true;
  return false;
}

/** The grid, built once. */
function grid(): Uint8Array {
  if (blockedGrid) return blockedGrid;
  const g = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < g.length; i++) g[i] = pathBlocked(cellX(i), cellZ(i)) ? 1 : 0;
  blockedGrid = g;
  return g;
}

/** The nearest open square to a square, searching outwards a few rings; -1 if none. */
function nearestOpen(g: Uint8Array, i: number): number {
  if (!g[i]) return i;
  const c0 = i % COLS;
  const r0 = Math.floor(i / COLS);
  for (let ring = 1; ring <= 6; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const r = mod(r0 + dr, ROWS);
        const c = mod(c0 + dc, COLS);
        if (!g[r * COLS + c]) return r * COLS + c;
      }
    }
  }
  return -1;
}

/** Whether the straight line from (x0, z0) to (x1, z1) stays on open squares, checked every half square. */
export function lineClear(x0: number, z0: number, x1: number, z1: number): boolean {
  const g = grid();
  const d = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(d / (PATH_CELL / 2)));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    if (g[cellOf(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)]) return false;
  }
  return true;
}

/** The search looks this far beyond the box round the start and the goal, m. */
const WINDOW_MARGIN = 160;

/**
 * The way from (fromX, fromZ) to (toX, toZ), both as given (the caller picks
 * the goal's copy of the repeating ground): the waypoints after the start,
 * the last the goal (or the open spot nearest it), each leg a clear straight
 * line. A* over the squares of a window round the two, eight ways, the
 * diagonals not cutting a blocked corner, then pulled straight. Empty if
 * there is no way.
 */
export function planPath(fromX: number, fromZ: number, toX: number, toZ: number): [number, number][] {
  const g = grid();
  // The goal, or the middle of the open square nearest it.
  const goalTile = cellOf(toX, toZ);
  const openGoal = nearestOpen(g, goalTile);
  if (openGoal < 0) return [];
  const end: [number, number] = goalTile === openGoal ? [toX, toZ] : cellNear(openGoal, toX, toZ, [0, 0]);
  if (lineClear(fromX, fromZ, end[0], end[1])) return [end];

  // The window: squares aligned with the grid's, so each is one of its squares.
  const x0 = Math.floor((Math.min(fromX, end[0]) - WINDOW_MARGIN - ORIGIN) / PATH_CELL) * PATH_CELL + ORIGIN;
  const z0 = Math.floor((Math.min(fromZ, end[1]) - WINDOW_MARGIN - ORIGIN) / PATH_CELL) * PATH_CELL + ORIGIN;
  const cols = Math.ceil((Math.max(fromX, end[0]) + WINDOW_MARGIN - x0) / PATH_CELL);
  const rows = Math.ceil((Math.max(fromZ, end[1]) + WINDOW_MARGIN - z0) / PATH_CELL);
  const n = cols * rows;
  const wx = (i: number) => x0 + ((i % cols) + 0.5) * PATH_CELL;
  const wz = (i: number) => z0 + (Math.floor(i / cols) + 0.5) * PATH_CELL;
  const blocked = (i: number) => g[cellOf(wx(i), wz(i))] === 1;
  const at = (x: number, z: number) => Math.floor((z - z0) / PATH_CELL) * cols + Math.floor((x - x0) / PATH_CELL);
  /** The open square nearest a window square, in rings; -1 if none near. */
  const open = (i: number): number => {
    if (!blocked(i)) return i;
    const c0 = i % cols;
    const r0 = Math.floor(i / cols);
    for (let ring = 1; ring <= 6; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const r = r0 + dr;
          const c = c0 + dc;
          if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
          if (!blocked(r * cols + c)) return r * cols + c;
        }
      }
    }
    return -1;
  };
  const start = open(at(fromX, fromZ));
  const goal = open(at(end[0], end[1]));
  if (start < 0 || goal < 0) return [];

  const cost = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const score = new Float32Array(n);
  const heap: number[] = [];
  const gc = goal % cols;
  const gr = Math.floor(goal / cols);
  const h = (i: number) => Math.hypot((i % cols) - gc, Math.floor(i / cols) - gr);
  const push = (i: number) => {
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (score[heap[p]] <= score[heap[k]]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && score[heap[l]] < score[heap[m]]) m = l;
        if (r < heap.length && score[heap[r]] < score[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  cost[start] = 0;
  score[start] = h(start);
  push(start);
  let found = false;
  while (heap.length > 0) {
    const i = pop();
    if (closed[i]) continue;
    if (i === goal) {
      found = true;
      break;
    }
    closed[i] = 1;
    const c = i % cols;
    const r = Math.floor(i / cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const j = rr * cols + cc;
        if (closed[j] || blocked(j)) continue;
        if (dr !== 0 && dc !== 0 && (blocked(r * cols + cc) || blocked(rr * cols + c))) continue;
        const next = cost[i] + (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1);
        if (next < cost[j]) {
          cost[j] = next;
          came[j] = i;
          score[j] = next + h(j);
          push(j);
        }
      }
    }
  }
  if (!found) return [];
  const cells: number[] = [];
  for (let i = goal; i !== -1; i = came[i]) cells.push(i);
  cells.reverse();

  // Pull it straight: from each point, on to the furthest later one in a clear line.
  const out: [number, number][] = [];
  let x = fromX;
  let z = fromZ;
  let k = 0;
  while (k < cells.length) {
    if (lineClear(x, z, end[0], end[1])) break;
    let far = k;
    for (let j = cells.length - 1; j > k; j--) {
      if (lineClear(x, z, wx(cells[j]), wz(cells[j]))) {
        far = j;
        break;
      }
    }
    x = wx(cells[far]);
    z = wz(cells[far]);
    out.push([x, z]);
    k = far + 1;
  }
  out.push(end);
  return out;
}

/** A path's length from (x, z) through its waypoints, m. */
export function pathLength(x: number, z: number, path: readonly (readonly [number, number])[]): number {
  let length = 0;
  for (const [px, pz] of path) {
    length += Math.hypot(px - x, pz - z);
    x = px;
    z = pz;
  }
  return length;
}
