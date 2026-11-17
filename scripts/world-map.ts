/**
 * A top-down map of the whole world (docs/world-map.md): the ground's
 * relief, the range, the biathlon course, the firing lanes, the obstacles
 * and the enemies, all read from the simulation's own numbers, so the map
 * is redrawn rather than kept up by hand. `node scripts/draw-map.mjs`
 * bundles this and renders the page it builds to docs/images/world-map.png.
 *
 * World space as src/sim/terrain.ts: +X east, -Z north (the tank's starting
 * heading), m. The ground repeats every TILE, so the map shows a little
 * more than one tile, with the copies of the tile's things beyond it
 * faded and the tile's own edge dashed.
 */

import { RANGE_TARGETS, targetFoot, MARKER_RANGES, markerFoot, ROAD } from '../src/sim/range.js';
import {
  BOX_Z,
  boxSpot,
  BRIDGE,
  BYPASS,
  BYPASS_PATH,
  COURSE,
  COURSE_PATH,
  COURSE_START,
  COURSE_TARGETS,
  FIRING_BOX,
  GATES,
  LINE_RANGE_SPAN,
  LINE_RANGES,
  MUD,
  PENALTY,
  PENALTY_GATE,
  PENALTY_PATH,
  samplePath,
  setLineRanges,
  SLALOM_POSTS,
  waterDepth,
} from '../src/sim/course.js';
import { COURSE_SIGNS } from '../src/sim/course-signs.js';
import { ENEMY_GUNS } from '../src/sim/enemy-guns.js';
import { ENEMY_TANKS } from '../src/sim/enemy-tanks.js';
import { SCENARIO } from '../src/sim/combat.js';
import { FIRING_LANES, groundHeight, HILL, LANE_WALLS, laneDirection, OBSTACLES, TILE } from '../src/sim/terrain.js';

/** The window the map shows, world m: a tile and a bit, placed so the range, the course and the lanes each read whole. */
export const MAP_WINDOW = { west: -360, east: 660, north: -740, south: 100 } as const;
/** The ground's relief is sampled this far apart, m. */
const STEP = 4;

const W = MAP_WINDOW.east - MAP_WINDOW.west;
const H = MAP_WINDOW.south - MAP_WINDOW.north;
const LEGEND = 350;

/** Each copy of the tile that (x, z) (tile-local) shows in, inside the window by `pad` m: [x, z, whether it is the tile's own]. */
function copies(x: number, z: number, pad = 40): [number, number, boolean][] {
  const out: [number, number, boolean][] = [];
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const cx = x + i * TILE;
      const cz = z + j * TILE;
      if (cx < MAP_WINDOW.west - pad || cx > MAP_WINDOW.east + pad || cz < MAP_WINDOW.north - pad || cz > MAP_WINDOW.south + pad) continue;
      out.push([cx, cz, i === 0 && j === 0]);
    }
  }
  return out;
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
const pts = (list: readonly (readonly [number, number])[]) => list.map(([x, z]) => `${f1(x)},${f1(z)}`).join(' ');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A label with a pale halo, world m. */
function label(x: number, z: number, text: string, opts: { size?: number; anchor?: 'start' | 'middle' | 'end'; color?: string; weight?: number } = {}): string {
  const { size = 11, anchor = 'start', color = '#1d2318', weight = 600 } = opts;
  return `<text x="${f1(x)}" y="${f1(z)}" font-size="${size}" text-anchor="${anchor}" fill="${color}" font-weight="${weight}" class="halo">${esc(text)}</text>`;
}

/** The ground's height every STEP m over the window, rows north to south. */
function relief(): { cols: number; rows: number; heights: number[]; water: number[] } {
  const cols = Math.round(W / STEP) + 1;
  const rows = Math.round(H / STEP) + 1;
  const heights: number[] = [];
  const water: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = MAP_WINDOW.west + c * STEP;
      const z = MAP_WINDOW.north + r * STEP;
      heights.push(Math.round(groundHeight(x, z) * 100) / 100);
      water.push(waterDepth(x, z) > 0.02 ? 1 : 0);
    }
  }
  return { cols, rows, heights, water };
}

/** The map's overlay: everything that stands on the ground, in world m. */
function overlay(): string {
  const out: string[] = [];
  const faded = (own: boolean) => (own ? '' : ' opacity="0.45"');

  // The tile's own edge.
  out.push(`<rect x="${-TILE / 2}" y="${-TILE / 2}" width="${TILE}" height="${TILE}" fill="none" stroke="#2a3140" stroke-width="1.5" stroke-dasharray="10 7" opacity="0.7"/>`);

  // The roads: up the range (x ≡ 0) and across the start (z ≡ 0).
  for (let i = -1; i <= 1; i++) {
    const x = i * TILE;
    if (x >= MAP_WINDOW.west && x <= MAP_WINDOW.east) out.push(`<rect x="${x - ROAD.halfWidth}" y="${MAP_WINDOW.north}" width="${2 * ROAD.halfWidth}" height="${H}" fill="#c9b48a" opacity="0.9"/>`);
    const z = i * TILE;
    if (z >= MAP_WINDOW.north && z <= MAP_WINDOW.south) out.push(`<rect x="${MAP_WINDOW.west}" y="${z - ROAD.crossHalfWidth}" width="${W}" height="${2 * ROAD.crossHalfWidth}" fill="#c9b48a" opacity="0.9"/>`);
  }

  // The firing lanes' flat strips.
  const d: [number, number] = [0, 0];
  FIRING_LANES.forEach((l) => {
    laneDirection(l, d);
    const rx = -d[1];
    const rz = d[0];
    const a = [l.x + rx * l.half, l.z + rz * l.half] as const;
    const b = [l.x - rx * l.half, l.z - rz * l.half] as const;
    const corners = [a, [a[0] + d[0] * l.length, a[1] + d[1] * l.length], [b[0] + d[0] * l.length, b[1] + d[1] * l.length], b] as const;
    for (const [cx, cz, own] of copies(l.x, l.z, 700)) {
      const shifted = corners.map(([x, z]) => [x + cx - l.x, z + cz - l.z] as const);
      out.push(`<polygon points="${pts(shifted)}" fill="#f3efc4" opacity="${own ? 0.35 : 0.15}" stroke="#b7a64a" stroke-width="0.8" stroke-dasharray="4 4"/>`);
    }
  });

  // The course: its gravel track, the penalty loop and the bypass, the mud and the bridge.
  const course = samplePath(COURSE_PATH, 0, COURSE_PATH.length, 4).map((p) => [p.x, p.z] as const);
  const penalty = samplePath(PENALTY_PATH, 0, PENALTY_PATH.length, 3).map((p) => [p.x, p.z] as const);
  const bypass = samplePath(BYPASS_PATH, 0, BYPASS_PATH.length, 2).map((p) => [p.x, p.z] as const);
  for (const [cx, cz, own] of copies(0, 0, 800)) {
    const shift = (list: readonly (readonly [number, number])[]) => list.map(([x, z]) => [x + cx, z + cz] as const);
    const g = `<g${faded(own)}>`;
    out.push(g);
    out.push(`<polyline points="${pts(shift(course))}" fill="none" stroke="#a49a86" stroke-width="${2 * COURSE.halfWidth}" stroke-linejoin="round"/>`);
    out.push(`<polyline points="${pts(shift(penalty))}" fill="none" stroke="#a49a86" stroke-width="${2 * PENALTY.halfWidth}" stroke-linejoin="round"/>`);
    out.push(`<polyline points="${pts(shift(bypass))}" fill="none" stroke="#b3a98f" stroke-width="${2 * BYPASS.halfWidth}" stroke-linejoin="round"/>`);
    out.push(`<rect x="${MUD.from + cx}" y="${COURSE.south - MUD.half + cz}" width="${MUD.to - MUD.from}" height="${2 * MUD.half}" fill="#6b4f2e" opacity="0.85"/>`);
    out.push(`<rect x="${BRIDGE.x - 3 + cx}" y="${BRIDGE.z - BRIDGE.length / 2 + cz}" width="6" height="${BRIDGE.length}" fill="#5d6670" stroke="#2f343a" stroke-width="0.6"/>`);
    // The gates, the finish line heavier.
    GATES.forEach((gate, i) => {
      const fx = -Math.sin(gate.heading);
      const fz = -Math.cos(gate.heading);
      const [x0, z0] = [gate.x + cx - fz * gate.half, gate.z + cz + fx * gate.half];
      const [x1, z1] = [gate.x + cx + fz * gate.half, gate.z + cz - fx * gate.half];
      out.push(`<line x1="${f1(x0)}" y1="${f1(z0)}" x2="${f1(x1)}" y2="${f1(z1)}" stroke="${i === 0 ? '#111' : '#d23c2c'}" stroke-width="${i === 0 ? 2.4 : 1.2}"/>`);
    });
    {
      const gate = PENALTY_GATE;
      const fx = -Math.sin(gate.heading);
      const fz = -Math.cos(gate.heading);
      out.push(`<line x1="${f1(gate.x + cx - fz * gate.half)}" y1="${f1(gate.z + cz + fx * gate.half)}" x2="${f1(gate.x + cx + fz * gate.half)}" y2="${f1(gate.z + cz - fx * gate.half)}" stroke="#e08a00" stroke-width="1.4"/>`);
    }
    for (const [x, z] of SLALOM_POSTS) out.push(`<circle cx="${f1(x + cx)}" cy="${f1(z + cz)}" r="0.9" fill="#c0262d"/>`);
    for (const s of COURSE_SIGNS) out.push(`<rect x="${f1(s.x + cx - 1.2)}" y="${f1(s.z + cz - 1.2)}" width="2.4" height="2.4" fill="${s.kind === 'chevron' ? '#e6b800' : '#f7f7f2'}" stroke="#222" stroke-width="0.5"/>`);
    // The firing boxes.
    BOX_Z.forEach((bz) => {
      out.push(`<rect x="${COURSE.east - FIRING_BOX.width / 2 + cx}" y="${bz - FIRING_BOX.length / 2 + cz}" width="${FIRING_BOX.width}" height="${FIRING_BOX.length}" fill="none" stroke="#2c62c9" stroke-width="1.4"/>`);
    });
    out.push('</g>');
  }

  // The obstacles: rocks, walls (the lane's cover walls darker) and houses.
  for (const o of OBSTACLES) {
    const cover = LANE_WALLS.includes(o);
    for (const [x, z, own] of copies(o.x, o.z)) {
      if (o.kind === 'rock') {
        out.push(`<circle cx="${f1(x)}" cy="${f1(z)}" r="${f1(Math.max(1.6, o.r))}" fill="#8b8d8f" stroke="#4c4e50" stroke-width="0.5"${faded(own)}/>`);
      } else {
        const deg = (-o.yaw * 180) / Math.PI;
        const fill = o.kind === 'house' ? '#a0583a' : cover ? '#3d3a35' : '#6f6a62';
        const hz = Math.max(o.hz, o.kind === 'wall' ? 1.2 : o.hz);
        out.push(`<rect x="${f1(-o.hx)}" y="${f1(-hz)}" width="${f1(2 * o.hx)}" height="${f1(2 * hz)}" fill="${fill}" transform="translate(${f1(x)} ${f1(z)}) rotate(${f1(deg)})"${faded(own)}/>`);
      }
    }
  }

  // The range: its targets and the markers beside its road.
  for (const r of MARKER_RANGES) {
    const [mx, mz] = markerFoot(r);
    for (const [x, z, own] of copies(mx, mz)) {
      out.push(`<rect x="${f1(x - 1.2)}" y="${f1(z - 1.2)}" width="2.4" height="2.4" fill="#fff" stroke="#333" stroke-width="0.6"${faded(own)}/>`);
      if (own) out.push(label(x + 4, z + 4, `${r} m`, { size: 8, color: '#3b3b3b', weight: 500 }));
    }
  }
  RANGE_TARGETS.forEach((t, i) => {
    const [tx, tz] = targetFoot(i);
    for (const [x, z, own] of copies(tx, tz)) {
      out.push(`<rect x="${f1(x - 4)}" y="${f1(z - 2)}" width="8" height="4" fill="#d9d9d9" stroke="#111" stroke-width="1.2"${faded(own)}/>`);
      if (own) out.push(label(x - 8, z + 4, `${t.range} m ${t.kind}`, { anchor: 'end', size: 10 }));
    }
  });

  // The firing lines: each line of fire out to 700 m, the span a race picks its boards in, and the boards where they stand before any race.
  setLineRanges(LINE_RANGES);
  BOX_Z.forEach((_, k) => {
    const [bx, bz] = boxSpot(k);
    laneDirection(FIRING_LANES[k], d);
    const [lo, hi] = LINE_RANGE_SPAN[k];
    for (const [cx, cz] of copies(bx, bz, 760)) {
      const ox = cx - bx;
      const oz = cz - bz;
      out.push(`<line x1="${f1(cx)}" y1="${f1(cz)}" x2="${f1(cx + d[0] * 700)}" y2="${f1(cz + d[1] * 700)}" stroke="#2c62c9" stroke-width="0.9" stroke-dasharray="6 4" opacity="0.8"/>`);
      out.push(`<line x1="${f1(cx + d[0] * lo)}" y1="${f1(cz + d[1] * lo)}" x2="${f1(cx + d[0] * hi)}" y2="${f1(cz + d[1] * hi)}" stroke="#2c62c9" stroke-width="5" opacity="0.35" stroke-linecap="round"/>`);
      COURSE_TARGETS.filter((t) => t.line === k).forEach((t) => {
        out.push(`<circle cx="${f1(t.x + ox)}" cy="${f1(t.z + oz)}" r="2.2" fill="#fff" stroke="#111" stroke-width="1"/>`);
      });
      const near = COURSE_TARGETS[k * 3];
      // Named only where the whole name fits in the window.
      if (near.x + ox - 6 > MAP_WINDOW.west + 160) out.push(label(near.x + ox - 6, near.z + oz + 3, `Line ${k + 1} boards, ${lo}–${hi} m`, { size: 10, anchor: 'end', color: '#173f8f' }));
    }
  });

  // The enemies: the guns (their barrels' way) and the tanks' routes.
  ENEMY_GUNS.forEach((g) => {
    for (const [x, z, own] of copies(g.x, g.z)) {
      const tip = [x + Math.sin(g.yaw) * 14, z + Math.cos(g.yaw) * 14];
      out.push(`<g${faded(own)}><line x1="${f1(x)}" y1="${f1(z)}" x2="${f1(tip[0])}" y2="${f1(tip[1])}" stroke="#a3161a" stroke-width="1.6"/><circle cx="${f1(x)}" cy="${f1(z)}" r="4" fill="#d7262b" stroke="#5c0a0c" stroke-width="1"/></g>`);
      out.push(label(x + 7, z - 6, g.name, { size: 10, color: own ? '#8c1014' : '#8c101488' }));
    }
  });
  ENEMY_TANKS.forEach((t) => {
    const [a, b] = t.points;
    for (const [x, z, own] of copies(a[0], a[1], 200)) {
      const ox = x - a[0];
      const oz = z - a[1];
      out.push(`<line x1="${f1(a[0] + ox)}" y1="${f1(a[1] + oz)}" x2="${f1(b[0] + ox)}" y2="${f1(b[1] + oz)}" stroke="#d7262b" stroke-width="2.4" stroke-dasharray="8 5"${faded(own)}/>`);
      out.push(label((a[0] + b[0]) / 2 + ox, (a[1] + b[1]) / 2 + oz - 8, `${t.name}'s route`, { size: 10, anchor: 'middle', color: own ? '#8c1014' : '#8c101488' }));
    }
  });

  // The Battle scenario's objective: the lane level with the 500 m board.
  for (const [x, z, own] of copies(0, SCENARIO.objectiveZ)) {
    if (!own) continue;
    out.push(`<line x1="${x - 18}" y1="${z}" x2="${x + 18}" y2="${z}" stroke="#7a2bb5" stroke-width="2.2"/>`);
    out.push(label(x + 22, z + 4, 'Battle objective', { size: 10, color: '#5b1d8a' }));
  }

  // The tank's start and the course's start, each facing north.
  const tank = (x: number, z: number, color: string) =>
    `<g transform="translate(${f1(x)} ${f1(z)})"><rect x="-3" y="-3.5" width="6" height="7" rx="1" fill="${color}" stroke="#111" stroke-width="0.8"/><line x1="0" y1="0" x2="0" y2="-9" stroke="#111" stroke-width="1.4"/></g>`;
  out.push(tank(0, 0, '#5f7a3a'));
  out.push(label(8, 14, 'Start', { size: 11 }));
  out.push(tank(COURSE_START.x, COURSE_START.z, '#5f7a3a'));

  // Names for the big things.
  out.push(label((COURSE.west + COURSE.east) / 2, (COURSE.north + COURSE.south) / 2 + 4, 'Biathlon course', { anchor: 'middle', size: 13 }));
  out.push(label(COURSE.east + 8, BOX_Z[1] + 2, 'Firing boxes', { size: 9, color: '#173f8f' }));
  out.push(label(COURSE.east + 46, -205, 'Penalty loop', { size: 9 }));
  out.push(label(HILL.crest, COURSE.north - 12, 'Hill', { anchor: 'middle', size: 9 }));
  out.push(label(BRIDGE.x - 8, BRIDGE.z + 3, 'Bridge', { anchor: 'end', size: 9 }));
  out.push(label((MUD.from + MUD.to) / 2, COURSE.south + 24, 'Mud', { anchor: 'middle', size: 9 }));
  out.push(label(286, -60, 'Ford', { size: 9 }));
  out.push(label(214, COURSE.north - 12, 'Slalom', { anchor: 'middle', size: 9 }));
  out.push(label(-10, MAP_WINDOW.north + 16, 'Range road', { anchor: 'end', size: 10 }));
  out.push(label(MAP_WINDOW.west + 8, -8, 'Cross road', { size: 10 }));
  return out.join('\n');
}

/** The legend, scale and north arrow, in the panel to the map's right (px). */
function legend(): string {
  const rows: [string, string][] = [
    ['<rect x="0" y="-5" width="18" height="8" fill="#c9b48a"/>', 'Dirt roads'],
    ['<rect x="0" y="-5" width="18" height="8" fill="#a49a86"/>', 'Course track, penalty loop and bypass'],
    ['<rect x="0" y="-5" width="18" height="8" fill="#6b4f2e"/>', 'Mud'],
    ['<line x1="0" y1="-1" x2="18" y2="-1" stroke="#111" stroke-width="2.4"/>', 'Finish line'],
    ['<line x1="0" y1="-1" x2="18" y2="-1" stroke="#d23c2c" stroke-width="1.4"/>', 'Course gates'],
    ['<rect x="4" y="-7" width="8" height="12" fill="none" stroke="#2c62c9" stroke-width="1.4"/>', 'Firing boxes'],
    ['<line x1="0" y1="-1" x2="18" y2="-1" stroke="#2c62c9" stroke-dasharray="6 4"/>', 'Line of fire (to 700 m)'],
    ['<line x1="0" y1="-1" x2="18" y2="-1" stroke="#2c62c9" stroke-width="5" opacity="0.35"/>', 'Where a race stands the boards'],
    ['<circle cx="9" cy="-1" r="3" fill="#fff" stroke="#111"/>', 'Biathlon boards (400 / 500 m)'],
    ['<rect x="0" y="-6" width="18" height="10" fill="#f3efc4" stroke="#b7a64a" stroke-dasharray="3 3"/>', 'Firing lanes (flat, kept clear)'],
    ['<rect x="3" y="-4" width="12" height="6" fill="#d9d9d9" stroke="#111"/>', 'Range targets'],
    ['<rect x="6" y="-4" width="6" height="6" fill="#fff" stroke="#333"/>', 'Range markers, every 100 m'],
    ['<circle cx="9" cy="-1" r="4" fill="#d7262b"/>', 'Enemy anti-tank guns'],
    ['<line x1="0" y1="-1" x2="18" y2="-1" stroke="#d7262b" stroke-width="2.4" stroke-dasharray="8 5"/>', "Enemy tanks' routes"],
    ['<line x1="0" y1="-1" x2="18" y2="-1" stroke="#7a2bb5" stroke-width="2.2"/>', 'Battle objective'],
    ['<circle cx="9" cy="-1" r="3" fill="#8b8d8f"/>', 'Rocks'],
    ['<rect x="0" y="-3" width="18" height="4" fill="#6f6a62"/>', 'Walls (cover walls darker)'],
    ['<rect x="4" y="-6" width="10" height="9" fill="#a0583a"/>', 'Houses'],
    ['<rect x="4" y="-6" width="10" height="9" fill="#3f86c7"/>', 'Water (the ford)'],
    ['<rect x="0" y="-6" width="18" height="10" fill="none" stroke="#2a3140" stroke-dasharray="5 3"/>', 'One 800 m tile (it repeats)'],
  ];
  const body = rows.map(([mark, text], i) => `<g transform="translate(0 ${i * 21})">${mark}<text x="28" y="3" font-size="12" fill="#1d2318">${esc(text)}</text></g>`).join('');
  return `<g transform="translate(18 40)">
    <text x="0" y="0" font-size="20" font-weight="700" fill="#1d2318">Track &amp; Barrel world</text>
    <text x="0" y="20" font-size="12" fill="#4a5244">Top-down, north up. Drawn from the game's code.</text>
    <g transform="translate(0 52)">${body}</g>
    <g transform="translate(0 ${52 + rows.length * 21 + 18})">
      <line x1="0" y1="0" x2="100" y2="0" stroke="#111" stroke-width="2"/>
      <line x1="0" y1="-5" x2="0" y2="5" stroke="#111" stroke-width="2"/><line x1="50" y1="-3" x2="50" y2="3" stroke="#111" stroke-width="1.5"/><line x1="100" y1="-5" x2="100" y2="5" stroke="#111" stroke-width="2"/>
      <text x="0" y="20" font-size="12" fill="#1d2318">0</text><text x="100" y="20" font-size="12" text-anchor="middle" fill="#1d2318">100 m</text>
      <g transform="translate(200 0)"><path d="M0 -26 L9 4 L0 -3 L-9 4 Z" fill="#111"/><text x="0" y="22" font-size="13" font-weight="700" text-anchor="middle">N</text></g>
    </g>
  </g>`;
}

/** The whole page: the relief on a canvas under the overlay, with the legend beside them. One map metre is one CSS pixel. */
export function worldMapPage(): string {
  const ground = relief();
  return `<!doctype html><html><head><meta charset="utf-8"><title>World map</title>
<style>
  html, body { margin: 0; background: #f4f2ea; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
  #map { position: relative; width: ${W + LEGEND}px; height: ${H}px; }
  canvas, svg { position: absolute; left: 0; top: 0; }
  .halo { paint-order: stroke; stroke: rgba(250, 250, 240, 0.85); stroke-width: 3px; stroke-linejoin: round; }
</style></head><body>
<div id="map">
  <canvas id="ground" width="${ground.cols}" height="${ground.rows}" style="width:${W}px;height:${H}px"></canvas>
  <svg width="${W}" height="${H}" viewBox="${MAP_WINDOW.west} ${MAP_WINDOW.north} ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${overlay()}</svg>
  <svg width="${LEGEND}" height="${H}" style="left:${W}px" xmlns="http://www.w3.org/2000/svg">${legend()}</svg>
</div>
<script>
  const g = ${JSON.stringify(ground)};
  const ctx = document.getElementById('ground').getContext('2d');
  const img = ctx.createImageData(g.cols, g.rows);
  const at = (c, r) => g.heights[Math.min(g.rows - 1, Math.max(0, r)) * g.cols + Math.min(g.cols - 1, Math.max(0, c))];
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const h = at(c, r);
      // Lit from the north-west: slopes facing it lighter.
      const shade = Math.max(-1, Math.min(1, ((at(c - 1, r) - at(c + 1, r)) + (at(c, r - 1) - at(c, r + 1))) * 1.6));
      const k = 1 + 0.18 * shade + 0.035 * h;
      const i = (r * g.cols + c) * 4;
      const wet = g.water[r * g.cols + c];
      img.data[i] = wet ? 63 : Math.min(255, 150 * k);
      img.data[i + 1] = wet ? 134 : Math.min(255, 176 * k);
      img.data[i + 2] = wet ? 199 : Math.min(255, 112 * k);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  document.body.dataset.ready = '1';
</script>
</body></html>`;
}

/** The map page's size in CSS pixels. */
export const MAP_SIZE = { width: W + LEGEND, height: H } as const;
