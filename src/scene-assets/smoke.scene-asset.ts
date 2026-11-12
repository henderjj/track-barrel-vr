import { BufferAttribute, DoubleSide, IcosahedronGeometry, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { mergeParts, type Part } from './lowpoly.js';

/**
 * A smoke round's screen (F3.1, docs/ammunition.md): a bank of puffs, low
 * poly, in a unit ball round its own middle with its long axis along x.
 * SmokeSystem scales it to the cloud's half length along the wind, its
 * height and its radius across (src/sim/ammo.ts SMOKE, smokeHalfLength) and
 * turns x downwind, so the wind draws the bank out as it holds. Its faces
 * show from inside too, so a crew in it sees grey, as in real smoke.
 *
 * Soft edges (John, 2026-11-12): each puff's rim breaks up into a ragged
 * fringe by alpha-to-coverage, the headset's own anti-aliasing samples
 * standing in for transparency. The material stays opaque (no blending, no
 * sorting, it writes depth), so it costs about what the solid bank did; the
 * puffs' middles are solid, so what hides the tank looks as dense as the
 * line of sight that smokeBlocks finds through it.
 */

/** The puffs: middle (unit space), radius and shade. Overlapping, never sharing a face; the downwind end (+x) a little thinner. */
const PUFFS: readonly { at: readonly [number, number, number]; r: number; color: number }[] = [
  { at: [0, 0.05, 0], r: 0.62, color: 0xdcdcd6 },
  { at: [-0.55, -0.05, 0.1], r: 0.46, color: 0xd2d2cc },
  { at: [0.55, -0.02, -0.08], r: 0.44, color: 0xe2e2dc },
  { at: [-0.26, 0.26, -0.24], r: 0.42, color: 0xe6e6e0 },
  { at: [0.3, 0.27, 0.24], r: 0.4, color: 0xd4d4ce },
  { at: [-0.3, -0.12, 0.5], r: 0.42, color: 0xcfcfc8 },
  { at: [0.28, -0.1, -0.52], r: 0.43, color: 0xd8d8d2 },
  { at: [0.04, -0.14, 0.56], r: 0.38, color: 0xdadad4 },
  { at: [-0.1, 0.4, 0.06], r: 0.34, color: 0xe0e0da },
  { at: [-0.78, 0.04, -0.2], r: 0.3, color: 0xd6d6d0 },
  { at: [0.8, -0.02, 0.14], r: 0.26, color: 0xdedcd6 },
];

/** Icosahedron detail for a puff: 80 faces. */
const DETAIL = 1;

/** The cloud's parts, for the mesh and the z-fighting test. */
export function smokeParts(): Part[] {
  return PUFFS.map((p, i) => ({
    geometry: new IcosahedronGeometry(p.r, DETAIL),
    color: p.color,
    position: p.at,
    // Each puff turned its own way, so no two have faces in one plane.
    rotation: [0.37 * i, 0.61 * i, 0.23 * i],
  }));
}

/**
 * Each vertex's way out from its own puff's middle: a puff's round normal,
 * where the merged mesh's own normals are its flat faces'. The shader fades
 * a puff's rim by it.
 */
function puffNormals(vertexCount: number, positions: ArrayLike<number>): Float32Array {
  const out = new Float32Array(vertexCount * 3);
  const perPuff = new IcosahedronGeometry(1, DETAIL).getAttribute('position').count;
  for (let v = 0; v < vertexCount; v++) {
    const p = PUFFS[Math.min(PUFFS.length - 1, Math.floor(v / perPuff))];
    const x = positions[v * 3] - p.at[0];
    const y = positions[v * 3 + 1] - p.at[1];
    const z = positions[v * 3 + 2] - p.at[2];
    const n = Math.hypot(x, y, z) || 1;
    out[v * 3] = x / n;
    out[v * 3 + 1] = y / n;
    out[v * 3 + 2] = z / n;
  }
  return out;
}

/** Rim fade, by how square to the eye a puff's surface is (1 facing it, 0 edge on): clear below `clear`, solid above `solid`, ± half `grain` of ragged noise. */
export const SMOKE_EDGE = { clear: 0.05, solid: 0.7, grain: 0.3 } as const;

const VERTEX_PARS = /* glsl */ `
attribute vec3 smokeNormal;
varying vec3 vSmokeNormal;
varying vec3 vSmokeView;
varying vec3 vSmokeLocal;
`;
const VERTEX = /* glsl */ `
vSmokeNormal = normalize(normalMatrix * smokeNormal);
vSmokeView = -mvPosition.xyz;
vSmokeLocal = position;
`;
const FRAGMENT_PARS = /* glsl */ `
varying vec3 vSmokeNormal;
varying vec3 vSmokeView;
varying vec3 vSmokeLocal;
float smokeHash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}
// Value noise: the hash at a lattice's corners, blended smoothly between them.
float smokeNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(smokeHash(i), smokeHash(i + vec3(1, 0, 0)), f.x), mix(smokeHash(i + vec3(0, 1, 0)), smokeHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(smokeHash(i + vec3(0, 0, 1)), smokeHash(i + vec3(1, 0, 1)), f.x), mix(smokeHash(i + vec3(0, 1, 1)), smokeHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`;
/** Square on to the eye a puff is solid; towards its rim it thins to nothing, ragged by a grain fixed in the cloud. */
const FRAGMENT = /* glsl */ `
float smokeFacing = abs(dot(normalize(vSmokeNormal), normalize(vSmokeView)));
float smokeGrain = 0.65 * smokeNoise(vSmokeLocal * 7.0) + 0.35 * smokeNoise(vSmokeLocal * 19.0);
diffuseColor.a = smoothstep(${SMOKE_EDGE.clear.toFixed(2)}, ${SMOKE_EDGE.solid.toFixed(2)}, smokeFacing + (smokeGrain - 0.5) * ${SMOKE_EDGE.grain.toFixed(2)});
`;

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, side: DoubleSide, alphaToCoverage: true });
material.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
    .replace('#include <opaque_fragment>', `${FRAGMENT}\n#include <opaque_fragment>`);
};
material.customProgramCacheKey = () => 'smoke-edge';

/** One smoke cloud, its middle at the origin, a unit ball across, its long axis x. */
export function createSmokeCloud(i: number): Mesh {
  const geometry = mergeParts(smokeParts());
  const pos = geometry.getAttribute('position');
  geometry.setAttribute('smokeNormal', new BufferAttribute(puffNormals(pos.count, pos.array), 3));
  const mesh = new Mesh(geometry, material);
  mesh.name = `Smoke ${i + 1}`;
  return mesh;
}
