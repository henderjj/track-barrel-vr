import { type Material, MeshStandardMaterial, Vector3, Vector4 } from '@iwsdk/core';
import { GLACIS, HULL, TURRET } from '../sim/cabin.js';
import {
  FLOOR_SHADE,
  FLOOR_SHADE_HEIGHT,
  INTERIOR_AMBIENT,
  INTERIOR_LIGHTS,
  TURRET_INSIDE,
  turretToHull,
  WRAP,
} from '../sim/interior.js';

/**
 * The cabin's lighting in the shader (docs/interior.md): a material given
 * `litInside` darkens the sky's image-based light wherever its surface is
 * inside the hull or the turret, and adds the pools of light from the open
 * hatches, the vision slit and the dome lamps, the sum in
 * src/sim/interior.ts (`interiorLight`). Outside the cabin it is drawn as
 * before. No real-time lights, no shadows: a few multiplies a pixel.
 *
 * Positions are taken in world space, which is hull space: the tank stays
 * at the origin and the world moves round it (plan decision 4). The turret
 * lights and the turret's inside turn with `setInteriorTurret`, which
 * CabinLightSystem calls each frame.
 */

const N = INTERIOR_LIGHTS.length;

/** Shared by every material given `litInside`, so one update reaches them all. */
export const interiorUniforms = {
  cabinOn: { value: 1 },
  cabinYaw: { value: 0 },
  cabinAmbient: { value: new Vector3(...INTERIOR_AMBIENT) },
  /** Each light's hull-space position, and in w its cone (0 for none). */
  cabinLightAt: { value: INTERIOR_LIGHTS.map(() => new Vector4()) },
  /** Each light's colour times strength, and its range in w. */
  cabinLightColor: { value: INTERIOR_LIGHTS.map((l) => new Vector4(l.color[0], l.color[1], l.color[2], l.range)) },
};

const turned: [number, number, number] = [0, 0, 0];

/** Turn the turret's lights and inside to `yaw` (rad, as src/sim/cabin.ts). Allocation-free. */
export function setInteriorTurret(yaw: number): void {
  interiorUniforms.cabinYaw.value = yaw;
  INTERIOR_LIGHTS.forEach((light, i) => {
    const at = light.frame === 'turret' ? turretToHull(light.at, yaw, turned) : light.at;
    interiorUniforms.cabinLightAt.value[i].set(at[0], at[1], at[2], light.cone);
  });
}
setInteriorTurret(0);

/** Turn the interior lighting on (1) or off (0, the sky's light everywhere, as before), for comparing. */
export function setInteriorLighting(on: boolean): void {
  interiorUniforms.cabinOn.value = on ? 1 : 0;
}

const f = (v: number) => v.toFixed(4);

const VERTEX_PARS = /* glsl */ `
varying vec3 vCabinWorld;
varying vec3 vCabinNormal;
`;
// After skinning, so a skinned glove is lit where it is drawn.
const VERTEX = /* glsl */ `
vCabinWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vCabinNormal = mat3(modelMatrix) * objectNormal;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float cabinOn;
uniform float cabinYaw;
uniform vec3 cabinAmbient;
uniform vec4 cabinLightAt[${N}];
uniform vec4 cabinLightColor[${N}];
varying vec3 vCabinWorld;
varying vec3 vCabinNormal;

float cabinFrontAt(float y) {
  return y <= ${f(GLACIS.noseTop)} ? ${f(HULL.front)}
    : y >= ${f(GLACIS.hoodBottom)} ? ${f(GLACIS.face)}
    : ${f(HULL.front)} + (y - ${f(GLACIS.noseTop)}) * ${f((GLACIS.face - HULL.front) / (GLACIS.hoodBottom - GLACIS.noseTop))};
}

bool cabinInside(vec3 p) {
  if (abs(p.x) < ${f(HULL.halfWidth + 0.03)} && p.y > -0.03 && p.y < ${f(HULL.roof + 0.03)} && p.z > cabinFrontAt(p.y) - 0.03 && p.z < ${f(HULL.rear + 0.03)}) return true;
  float c = cos(cabinYaw);
  float s = sin(cabinYaw);
  float z = p.z - ${f(TURRET.z)};
  vec2 t = vec2(p.x * c - z * s, p.x * s + z * c);
  return abs(t.x) < ${f(TURRET_INSIDE.halfWidth + 0.03)} && abs(t.y) < ${f(TURRET_INSIDE.halfWidth + 0.03)} && p.y > ${f(TURRET_INSIDE.floor)} && p.y < ${f(TURRET_INSIDE.roof + 0.03)};
}

vec3 cabinLight(vec3 p, vec3 n) {
  float low = mix(${f(FLOOR_SHADE)}, 1.0, smoothstep(0.0, ${f(FLOOR_SHADE_HEIGHT)}, p.y));
  vec3 light = cabinAmbient * low;
  for (int i = 0; i < ${N}; i++) {
    vec3 d = cabinLightAt[i].xyz - p;
    float d2 = dot(d, d);
    float r = cabinLightColor[i].w;
    float inv = inversesqrt(d2);
    float facing = ${f(WRAP)} + ${f(1 - WRAP)} * max(dot(n, d) * inv, 0.0);
    float cone = cabinLightAt[i].w > 0.0 ? pow(max(d.y * inv, 0.0), cabinLightAt[i].w) : 1.0;
    light += cabinLightColor[i].rgb * facing * cone / (1.0 + d2 / (r * r));
  }
  return light;
}
`;
const FRAGMENT = /* glsl */ `
if (cabinOn > 0.5 && cabinInside(vCabinWorld)) {
  vec3 cabinLit = cabinLight(vCabinWorld, normalize(vCabinNormal));
  reflectedLight.indirectDiffuse *= cabinLit;
  reflectedLight.indirectSpecular *= cabinLit;
}
`;

/** Light `material` (a MeshStandardMaterial) as inside the tank where it is inside the tank. Returns it. */
export function litInside<M extends Material>(material: M): M {
  if (!(material instanceof MeshStandardMaterial)) return material;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, interiorUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>\n${VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <aomap_fragment>', `${FRAGMENT}\n#include <aomap_fragment>`);
  };
  material.customProgramCacheKey = () => 'cabin-light';
  return material;
}
